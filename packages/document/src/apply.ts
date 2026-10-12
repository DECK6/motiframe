import { compileProject } from "../../core/src/compile";
import { validateScore } from "../../core/src/score/schema";
import { sliceCurve, splitCurve, trimMedia } from "./clip-commands";
import {
  type EditCommand,
  type EditTransaction,
  editTransactionSchema,
  type TransactionInverse,
} from "./commands";
import { applyDefinitionRevision } from "./definition-commands";
import { checkChannelEdit, upsertKeyframe } from "./keyframe-commands";
import { updateReference } from "./reference-commands";
import { fail, ok, type Result } from "./result";
import type { Keyframe, ProjectDocument } from "./schema";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** Stable browser-compatible content identity. Revision and top-level audit are excluded. */
export function projectContentHash(document: ProjectDocument): string {
  const content = { ...document } as Record<string, unknown>;
  delete content.revision;
  delete content.audit;
  let hash = 14695981039346656037n;
  for (const char of canonical(content)) {
    hash ^= BigInt(char.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, "0");
}
const validTick = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function applyTransaction(
  document: ProjectDocument,
  transaction: EditTransaction,
): Result<{ document: ProjectDocument; inverse: TransactionInverse; affectedIds: string[] }> {
  try {
    const parsed = editTransactionSchema.safeParse(transaction);
    if (!parsed.success)
      return fail(
        "INVALID_TRANSACTION",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    return apply(document, parsed.data);
  } catch (error) {
    return fail("INVALID_TRANSACTION", error instanceof Error ? error.message : "Invalid transaction");
  }
}
function apply(
  document: ProjectDocument,
  tx: EditTransaction,
): Result<{ document: ProjectDocument; inverse: TransactionInverse; affectedIds: string[] }> {
  if (
    !tx ||
    !Array.isArray(tx.commands) ||
    !tx.scope ||
    !["user", "agent", "recipe"].includes(tx.author) ||
    typeof tx.id !== "string"
  )
    return fail("INVALID_TRANSACTION", "Invalid transaction envelope");
  if (tx.baseRevision !== document.revision)
    return fail("REVISION_CONFLICT", "Document revision changed", [document.id]);
  const { range } = tx.scope;
  if (
    !Array.isArray(tx.scope.instanceIds) ||
    !validTick(range?.start) ||
    !validTick(range?.end) ||
    range.end <= range.start ||
    typeof tx.scope.preserveDuration !== "boolean" ||
    typeof tx.scope.ripple !== "boolean"
  )
    return fail("INVALID_SCOPE", "Invalid edit scope");
  const doc = structuredClone(document),
    affected = new Set<string>(),
    temporal = new Set<string>();
  const scope = new Set(tx.scope.instanceIds);
  const initial = compileProject(doc);
  if (!initial.ok) return initial;
  const globalStart = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return NaN;
    seen.add(id);
    const i = doc.instances[id];
    if (!i) return NaN;
    return (
      i.start +
      (i.parentId
        ? globalStart(i.parentId, seen)
        : (Object.values(doc.scenes).find((s) => s.rootIds.includes(id))?.start ?? 0))
    );
  };
  const lockedAncestor = (id: string): boolean => {
    const seen = new Set<string>();
    let current: string | null = id;
    while (current && !seen.has(current)) {
      seen.add(current);
      const i: ProjectDocument["instances"][string] | undefined = doc.instances[current];
      if (!i) return false;
      if (i.locked || doc.tracks.find((t) => t.id === i.trackId)?.locked) return true;
      current = i.parentId;
    }
    return false;
  };
  const permit = (id: string, unlock = false, at?: number): Result<void> => {
    const i = doc.instances[id];
    if (!scope.has(id)) return fail("SCOPE_CONFLICT", "Instance is outside authorized scope", [id]);
    if (!i) return fail("MISSING_INSTANCE", "Unknown instance", [id]);
    if (!unlock && lockedAncestor(id)) return fail("LOCKED", "Instance or track is locked", [id]);
    const start = globalStart(id),
      end = start + i.duration;
    if (!Number.isFinite(start)) return fail("PARENT_CYCLE", "Invalid parent graph", [id]);
    if (at === undefined ? start < range.start || end > range.end : at < range.start || at > range.end)
      return fail("RANGE_CONFLICT", "Edit exceeds the authorized time range", [id]);
    affected.add(id);
    return ok(undefined);
  };
  const permitSemantic = (value: unknown, score = doc.score): Result<void> => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fail("INVALID_SCOPE", "Scoped metadata must be an object");
    const item = value as Record<string, unknown>;
    let ids: string[] = [];
    if (Array.isArray(item.targetIds)) ids.push(...(item.targetIds as string[]));
    if (Array.isArray(item.instanceIds)) ids.push(...(item.instanceIds as string[]));
    if (Array.isArray(item.actorIds)) ids.push(...(item.actorIds as string[]));
    for (const key of ["primaryActor", "fromTarget", "toTarget"])
      if (typeof item[key] === "string") ids.push(item[key] as string);
    if (typeof item.cueEvent === "string") {
      const cue = score.events.find(
        (e) => e && typeof e === "object" && !Array.isArray(e) && e.id === item.cueEvent,
      ) as { targetIds?: string[]; tick?: number } | undefined;
      ids.push(...(cue?.targetIds ?? []));
    }
    const r = (item.range ??
      item.appliedRange ??
      (typeof item.tick === "number"
        ? { start: item.tick, end: item.tick }
        : typeof item.at === "number"
          ? { start: item.at, end: item.at }
          : range)) as { start: number; end: number };
    if (
      !validTick(r.start) ||
      !validTick(r.end) ||
      r.start > r.end ||
      r.start < range.start ||
      r.end > range.end
    )
      return fail("RANGE_CONFLICT", "Metadata exceeds the authorized time range");
    for (const id of new Set(ids)) {
      const allowed = permit(id, false, r.start);
      if (!allowed.ok) return allowed;
    }
    return ok(undefined);
  };
  const permitProject = (): Result<void> =>
    tx.author === "user" &&
    Object.keys(doc.instances).every((id) => scope.has(id)) &&
    range.start === 0 &&
    range.end >= doc.settings.duration
      ? ok(undefined)
      : fail(
          "SCOPE_CONFLICT",
          "Project settings and asset registration require a full-project user transaction",
        );
  const permitCurve = (id: string, before: Keyframe[], after: Keyframe[], keyId: string): Result<void> => {
    const duration = doc.instances[id].duration,
      origin = globalStart(id);
    const bounds = (keys: Keyframe[]) => {
      const index = keys.findIndex((k) => k.id === keyId);
      if (index < 0) return null;
      return {
        start: index > 0 ? keys[index - 1].at : 0,
        end: index + 1 < keys.length ? keys[index + 1].at : duration,
      };
    };
    const intervals = [bounds(before), bounds(after)].filter((x): x is { start: number; end: number } =>
      Boolean(x),
    );
    if (!before.length || !after.length) intervals.push({ start: 0, end: duration });
    if (
      intervals.some(
        (r) => origin + Math.max(0, r.start) < range.start || origin + Math.min(duration, r.end) > range.end,
      )
    )
      return fail(
        "SCOPE_CONFLICT",
        "Keyframe interpolation affects frames outside the authorized range; include the affected neighbouring segments",
        [id],
      );
    return ok(undefined);
  };
  const remove = (id: string) => {
    delete doc.instances[id];
    delete doc.mediaClips[id];
    for (const [key, c] of Object.entries(doc.channels))
      if (c.target.instanceId === id) delete doc.channels[key];
    for (const t of doc.tracks) t.instanceIds = t.instanceIds.filter((v) => v !== id);
    for (const s of Object.values(doc.scenes)) s.rootIds = s.rootIds.filter((v) => v !== id);
  };
  const duplicate = (id: string, nextId: string, start?: number): Result<void> => {
    if (!scope.has(nextId)) return fail("SCOPE_CONFLICT", "New instance must be in edit scope", [nextId]);
    if (doc.instances[nextId]) return fail("DUPLICATE_ID", "Instance ID already exists", [nextId]);
    if (Object.values(doc.instances).some((i) => i.parentId === id))
      return fail("HAS_CHILDREN", "Duplicate a leaf instance or explicitly duplicate its children", [id]);
    const source = doc.instances[id];
    doc.instances[nextId] = { ...structuredClone(source), start: start ?? source.start };
    doc.tracks.find((t) => t.id === source.trackId)!.instanceIds.push(nextId);
    for (const s of Object.values(doc.scenes)) if (s.rootIds.includes(id)) s.rootIds.push(nextId);
    for (const [channelId, c] of Object.entries(doc.channels))
      if (c.target.instanceId === id)
        doc.channels[`${nextId}:${channelId}`] = {
          ...structuredClone(c),
          target: { ...c.target, instanceId: nextId },
          keys: c.keys.map((k) => ({ ...structuredClone(k), id: `${nextId}:${k.id}` })),
        };
    if (doc.mediaClips[id]) doc.mediaClips[nextId] = structuredClone(doc.mediaClips[id]);
    affected.add(nextId);
    return ok(undefined);
  };
  for (const command of tx.commands) {
    const cmd = command as EditCommand;
    if (!cmd || typeof cmd.type !== "string") return fail("INVALID_COMMAND", "Command type is required");
    if ("instanceId" in cmd && cmd.instanceId && cmd.type !== "AddInstance") {
      const check = permit(cmd.instanceId, cmd.type === "SetLock" && tx.author === "user");
      if (!check.ok) return check;
    }
    if ("channelId" in cmd && cmd.channelId) {
      const channel = doc.channels[cmd.channelId];
      if (channel) {
        const keyTick =
          cmd.type === "SetKeyframe"
            ? cmd.key.at
            : cmd.type === "RemoveKeyframe"
              ? channel.keys.find((k) => k.id === cmd.keyId)?.at
              : undefined;
        const at = keyTick === undefined ? undefined : globalStart(channel.target.instanceId) + keyTick;
        const check = permit(channel.target.instanceId, false, at);
        if (!check.ok) return check;
        const ownership = checkChannelEdit(channel, tx.author);
        if (!ownership.ok && !(cmd.type === "SetLock" && tx.author === "user")) return ownership;
      } else if (cmd.type !== "SetKeyframe")
        return fail("MISSING_CHANNEL", "Unknown channel", [cmd.channelId]);
    }
    if (
      "instanceId" in cmd &&
      cmd.instanceId &&
      ["AddInstance", "MoveInstance", "TrimClip", "SplitClip", "DuplicateInstance"].includes(cmd.type)
    )
      temporal.add(cmd.instanceId);
    if ("newInstanceId" in cmd) temporal.add(cmd.newInstanceId);
    switch (cmd.type) {
      case "SetMediaClip": {
        if (tx.author === "recipe") return fail("OWNERSHIP_CONFLICT", "Recipes cannot change media sources");
        const value = cmd.clip;
        if (!value || typeof value !== "object" || Array.isArray(value))
          return fail("INVALID_MEDIA", "Media clip must be an object");
        const clip = value as Record<string, unknown>,
          rate = clip.rate as { num: number; den: number } | undefined;
        const sourceIn = clip.sourceIn as number,
          sourceOut = clip.sourceOut as number;
        if (
          typeof clip.assetId !== "string" ||
          !doc.assets[clip.assetId] ||
          !validTick(sourceIn) ||
          !validTick(sourceOut) ||
          sourceOut <= sourceIn ||
          !rate ||
          !Number.isSafeInteger(rate.num) ||
          !Number.isSafeInteger(rate.den) ||
          rate.num <= 0 ||
          rate.den <= 0 ||
          typeof clip.gain !== "number" ||
          !Number.isFinite(clip.gain) ||
          clip.gain < 0
        )
          return fail(
            "INVALID_MEDIA",
            "Media needs an existing asset, positive source range and rational rate, and finite nonnegative gain",
            [cmd.instanceId],
          );
        const required = (doc.instances[cmd.instanceId].duration * rate.num) / rate.den;
        if (!Number.isSafeInteger(required) || required > sourceOut - sourceIn)
          return fail("MEDIA_RANGE", "Source range must cover the instance at its exact playback rate", [
            cmd.instanceId,
          ]);
        doc.mediaClips[cmd.instanceId] = structuredClone(cmd.clip);
        break;
      }
      case "SetTrackMuted": {
        if (tx.author === "recipe") return fail("OWNERSHIP_CONFLICT", "Recipes cannot mute tracks");
        const track = doc.tracks.find((t) => t.id === cmd.trackId);
        if (!track) return fail("MISSING_TRACK", "Unknown track");
        if (track.locked) return fail("LOCKED", "Track is locked", [track.id]);
        for (const id of track.instanceIds) {
          const allowed = permit(id);
          if (!allowed.ok) return allowed;
        }
        track.muted = cmd.muted;
        break;
      }
      case "RegisterAsset": {
        const allowed = permitProject();
        if (!allowed.ok) return allowed;
        if (!cmd.assetId || !cmd.asset || typeof cmd.asset !== "object" || Array.isArray(cmd.asset))
          return fail("INVALID_ASSET", "A stable asset ID and metadata object are required");
        if (doc.assets[cmd.assetId] && canonical(doc.assets[cmd.assetId]) !== canonical(cmd.asset))
          return fail("ASSET_CONFLICT", "An asset ID cannot be replaced with different content", [
            cmd.assetId,
          ]);
        doc.assets[cmd.assetId] = structuredClone(cmd.asset);
        break;
      }
      case "UpdateSettings": {
        const allowed = permitProject();
        if (!allowed.ok) return allowed;
        if (
          cmd.settings.duration !== undefined &&
          cmd.settings.duration !== doc.settings.duration &&
          tx.scope.preserveDuration
        )
          return fail("DURATION_CONFLICT", "Scope preserves project duration");
        if (
          cmd.settings.duration !== undefined &&
          (cmd.settings.duration > range.end ||
            Object.keys(doc.instances).some(
              (id) => globalStart(id) + doc.instances[id].duration > cmd.settings.duration!,
            ))
        )
          return fail("DURATION_CONFLICT", "New duration excludes clips or exceeds the authorized range");
        doc.settings = { ...doc.settings, ...structuredClone(cmd.settings) };
        break;
      }
      case "ApplyDefinitionRevision": {
        if (tx.author === "recipe")
          return fail("OWNERSHIP_CONFLICT", "A recipe cannot switch source definitions");
        for (const id of cmd.instanceIds) {
          const check = permit(id);
          if (!check.ok) return check;
        }
        const next = applyDefinitionRevision(doc, cmd);
        if (!next.ok) return next;
        Object.assign(doc, next.value.document);
        break;
      }
      case "AddInstance": {
        if (cmd.instance.parentId && lockedAncestor(cmd.instance.parentId))
          return fail("LOCKED", "Destination parent is locked", [cmd.instance.parentId]);
        if (!scope.has(cmd.instanceId))
          return fail("SCOPE_CONFLICT", "New instance is outside scope", [cmd.instanceId]);
        if (doc.instances[cmd.instanceId])
          return fail("DUPLICATE_ID", "Instance already exists", [cmd.instanceId]);
        const track = doc.tracks.find((t) => t.id === cmd.instance.trackId);
        if (!track) return fail("MISSING_TRACK", "Unknown track");
        if (track.locked) return fail("LOCKED", "Track is locked", [track.id]);
        doc.instances[cmd.instanceId] = structuredClone(cmd.instance);
        track.instanceIds.splice(cmd.index ?? track.instanceIds.length, 0, cmd.instanceId);
        if (!cmd.instance.parentId) {
          const scene = doc.scenes[cmd.sceneId ?? Object.keys(doc.scenes)[0]];
          if (!scene) return fail("MISSING_SCENE", "Unknown scene");
          scene.rootIds.push(cmd.instanceId);
        }
        affected.add(cmd.instanceId);
        break;
      }
      case "RemoveInstance": {
        if (Object.values(doc.instances).some((i) => i.parentId === cmd.instanceId))
          return fail("HAS_CHILDREN", "Remove children explicitly before their parent", [cmd.instanceId]);
        for (const c of Object.values(doc.channels))
          if (c.target.instanceId === cmd.instanceId) {
            const check = checkChannelEdit(c, tx.author);
            if (!check.ok) return check;
          }
        remove(cmd.instanceId);
        break;
      }
      case "MoveInstance": {
        if (cmd.parentId && lockedAncestor(cmd.parentId))
          return fail("LOCKED", "Destination parent is locked", [cmd.parentId]);
        const pending = [cmd.instanceId],
          visited = new Set<string>();
        while (pending.length) {
          const parent = pending.pop()!;
          if (visited.has(parent)) continue;
          visited.add(parent);
          for (const [childId, child] of Object.entries(doc.instances))
            if (child.parentId === parent) {
              const allowed = permit(childId);
              if (!allowed.ok) return allowed;
              pending.push(childId);
              temporal.add(childId);
            }
        }
        const instance = doc.instances[cmd.instanceId];
        const track = doc.tracks.find((t) => t.id === (cmd.trackId ?? instance.trackId));
        if (!track) return fail("MISSING_TRACK", "Unknown track");
        if (track.locked) return fail("LOCKED", "Destination track is locked", [track.id]);
        if (cmd.trackId && cmd.trackId !== instance.trackId) {
          doc.tracks.find((t) => t.id === instance.trackId)!.instanceIds = doc.tracks
            .find((t) => t.id === instance.trackId)!
            .instanceIds.filter((id) => id !== cmd.instanceId);
          track.instanceIds.push(cmd.instanceId);
          instance.trackId = track.id;
        }
        instance.start = cmd.start;
        if (cmd.parentId !== undefined) {
          instance.parentId = cmd.parentId;
          instance.slotId = cmd.slotId ?? null;
          for (const scene of Object.values(doc.scenes))
            scene.rootIds = scene.rootIds.filter((id) => id !== cmd.instanceId);
          if (!cmd.parentId) {
            const scene = doc.scenes[cmd.sceneId ?? Object.keys(doc.scenes)[0]];
            if (!scene) return fail("MISSING_SCENE", "Unknown scene");
            scene.rootIds.push(cmd.instanceId);
          }
        }
        break;
      }
      case "SetProps":
        doc.instances[cmd.instanceId].props = cmd.replace
          ? structuredClone(cmd.props)
          : { ...doc.instances[cmd.instanceId].props, ...structuredClone(cmd.props) };
        break;
      case "DuplicateInstance": {
        const check = duplicate(cmd.instanceId, cmd.newInstanceId, cmd.start);
        if (!check.ok) return check;
        break;
      }
      case "SplitClip": {
        const instance = doc.instances[cmd.instanceId],
          local = cmd.at - globalStart(cmd.instanceId);
        if (!validTick(local) || local <= 0 || local >= instance.duration)
          return fail("INVALID_SPLIT", "Split must be strictly inside the clip", [cmd.instanceId]);
        const check = duplicate(cmd.instanceId, cmd.newInstanceId, instance.start + local);
        if (!check.ok) return check;
        const duration = instance.duration;
        instance.duration = local;
        doc.instances[cmd.newInstanceId].duration = duration - local;
        for (const [id, c] of Object.entries(doc.channels))
          if (c.target.instanceId === cmd.instanceId) {
            const allowed = checkChannelEdit(c, tx.author);
            if (!allowed.ok) return allowed;
            const split = splitCurve(c.keys, local, `${cmd.newInstanceId}:${id}`);
            if (!split.ok) return split;
            c.keys = split.value.left;
            doc.channels[`${cmd.newInstanceId}:${id}`].keys = split.value.right;
          }
        if (doc.mediaClips[cmd.instanceId]) {
          const left = trimMedia(doc.mediaClips[cmd.instanceId], 0, local),
            right = trimMedia(doc.mediaClips[cmd.instanceId], local, duration - local);
          if (!left.ok) return left;
          if (!right.ok) return right;
          doc.mediaClips[cmd.instanceId] = left.value;
          doc.mediaClips[cmd.newInstanceId] = right.value;
        }
        break;
      }
      case "TrimClip": {
        const instance = doc.instances[cmd.instanceId],
          delta = cmd.start - instance.start,
          oldEnd = globalStart(cmd.instanceId) + instance.duration,
          change = delta + cmd.duration - instance.duration;
        if (
          !validTick(delta) ||
          !validTick(cmd.duration) ||
          cmd.duration <= 0 ||
          delta + cmd.duration > instance.duration
        )
          return fail("INVALID_TRIM", "Trim must stay inside original bounds", [cmd.instanceId]);
        for (const [id, c] of Object.entries(doc.channels))
          if (c.target.instanceId === cmd.instanceId) {
            const allowed = checkChannelEdit(c, tx.author);
            if (!allowed.ok) return allowed;
            const sliced = sliceCurve(c.keys, delta, delta + cmd.duration, `${tx.id}:${id}`);
            if (!sliced.ok) return sliced;
            c.keys = sliced.value;
          }
        if (doc.mediaClips[cmd.instanceId]) {
          const media = trimMedia(doc.mediaClips[cmd.instanceId], delta, cmd.duration);
          if (!media.ok) return media;
          doc.mediaClips[cmd.instanceId] = media.value;
        }
        if (tx.scope.ripple && change !== 0)
          for (const [id, next] of Object.entries(doc.instances))
            if (
              id !== cmd.instanceId &&
              next.trackId === instance.trackId &&
              next.parentId === instance.parentId &&
              globalStart(id) >= oldEnd
            ) {
              const allowed = permit(id);
              if (!allowed.ok) return allowed;
              next.start += change;
              temporal.add(id);
            }
        instance.start = cmd.start;
        instance.duration = cmd.duration;
        break;
      }
      case "ReorderTrack": {
        const index = doc.tracks.findIndex((t) => t.id === cmd.trackId);
        if (index < 0 || !Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index >= doc.tracks.length)
          return fail("INVALID_TRACK_ORDER", "Invalid track/index");
        const track = doc.tracks[index];
        if (track.locked) return fail("LOCKED", "Track is locked");
        for (const id of doc.tracks
          .slice(Math.min(index, cmd.index), Math.max(index, cmd.index) + 1)
          .flatMap((t) => t.instanceIds)) {
          const check = permit(id);
          if (!check.ok) return check;
        }
        doc.tracks.splice(index, 1);
        doc.tracks.splice(cmd.index, 0, track);
        break;
      }
      case "SetKeyframe": {
        let channel = doc.channels[cmd.channelId];
        if (!channel) {
          if (!cmd.target) return fail("MISSING_TARGET", "New channel requires a target");
          const check = permit(cmd.target.instanceId, false, globalStart(cmd.target.instanceId) + cmd.key.at);
          if (!check.ok) return check;
          channel = {
            target: structuredClone(cmd.target),
            owner: cmd.owner ?? (tx.author === "recipe" ? "recipe" : "manual"),
            locked: false,
            keys: [],
            ...(cmd.recipeId ? { recipeId: cmd.recipeId } : {}),
          };
          if (tx.author === "recipe" && channel.owner !== "recipe")
            return fail("OWNERSHIP_CONFLICT", "Recipe needs recipe ownership");
          doc.channels[cmd.channelId] = channel;
        }
        if (tx.author === "recipe" && cmd.recipeId && channel.recipeId && channel.recipeId !== cmd.recipeId)
          return fail("OWNERSHIP_CONFLICT", "Another recipe owns this channel", [cmd.channelId]);
        const keys = upsertKeyframe(channel.keys, cmd.key);
        if (!keys.ok) return keys;
        const permitted = permitCurve(channel.target.instanceId, channel.keys, keys.value, cmd.key.id);
        if (!permitted.ok) return permitted;
        channel.keys = keys.value;
        break;
      }
      case "RemoveKeyframe": {
        const channel = doc.channels[cmd.channelId];
        if (!channel.keys.some((k) => k.id === cmd.keyId))
          return fail("MISSING_KEYFRAME", "Unknown key", [cmd.keyId]);
        const keys = channel.keys.filter((k) => k.id !== cmd.keyId);
        const permitted = permitCurve(channel.target.instanceId, channel.keys, keys, cmd.keyId);
        if (!permitted.ok) return permitted;
        channel.keys = keys;
        if (!channel.keys.length) delete doc.channels[cmd.channelId];
        break;
      }
      case "SetChannelOwner": {
        if (tx.author !== "user")
          return fail("OWNERSHIP_CONFLICT", "Only the user can transfer channel ownership");
        const channel = doc.channels[cmd.channelId];
        channel.owner = cmd.owner;
        if (cmd.owner === "recipe" && cmd.recipeId) channel.recipeId = cmd.recipeId;
        else delete channel.recipeId;
        break;
      }
      case "SetLock": {
        if (tx.author !== "user") return fail("LOCKED", "Only the user can change locks");
        if ([cmd.instanceId, cmd.channelId, cmd.trackId].filter(Boolean).length !== 1)
          return fail("INVALID_LOCK", "Specify exactly one lock target");
        if (cmd.instanceId) doc.instances[cmd.instanceId].locked = cmd.locked;
        else if (cmd.channelId) doc.channels[cmd.channelId].locked = cmd.locked;
        else {
          const track = doc.tracks.find((t) => t.id === cmd.trackId);
          if (!track) return fail("MISSING_TRACK", "Unknown track");
          for (const id of track.instanceIds) {
            const check = permit(id, true);
            if (!check.ok) return check;
          }
          track.locked = cmd.locked;
        }
        break;
      }
      case "UpdateScore": {
        for (const key of Object.keys(cmd.score))
          if (!["phrases", "events", "windows", "tensions", "handoffs"].includes(key))
            return fail("INVALID_SCORE", "Unknown score collection");
        const next = { ...doc.score, ...structuredClone(cmd.score) };
        for (const key of Object.keys(cmd.score) as (keyof ProjectDocument["score"])[]) {
          if (!Array.isArray(next[key])) return fail("INVALID_SCORE", "Score collection must be an array");
          const oldEntries = doc.score[key],
            newEntries = next[key];
          for (const entry of [...oldEntries, ...newEntries]) {
            const opposite = oldEntries.includes(entry) ? newEntries : oldEntries;
            if (opposite.some((other) => canonical(other) === canonical(entry))) continue;
            const allowed = permitSemantic(entry, next);
            if (!allowed.ok) return allowed;
          }
        }
        doc.score = next;
        break;
      }
      case "SetReference": {
        const ref =
          cmd.reference && typeof cmd.reference === "object" && !Array.isArray(cmd.reference)
            ? cmd.reference
            : undefined;
        const referenceId = cmd.referenceId ?? (typeof ref?.id === "string" ? ref.id : undefined);
        const existing = doc.references.filter(
          (r) => r && typeof r === "object" && !Array.isArray(r) && r.id === referenceId,
        );
        const references = cmd.remove ? existing : [...existing, cmd.reference];
        for (const reference of references) {
          const allowed = permitSemantic(reference);
          if (!allowed.ok) return allowed;
        }
        const changed = updateReference(doc.references, cmd.reference, cmd.referenceId, cmd.remove);
        if (!changed.ok) return changed;
        doc.references = changed.value;
        break;
      }
      default:
        return fail("INVALID_COMMAND", "Unsupported edit command");
    }
  }
  const compiled = compileProject(doc);
  if (!compiled.ok) return compiled;
  const scoreCheck = validateScore(doc);
  if (!scoreCheck.ok) return scoreCheck;
  let end = 0;
  for (const [id, instance] of Object.entries(doc.instances)) {
    const start = compiled.value.starts[id];
    end = Math.max(end, start + instance.duration);
    if (temporal.has(id) && (start < range.start || start + instance.duration > range.end))
      return fail("RANGE_CONFLICT", "Result exceeds authorized time range", [id]);
    for (const channel of Object.values(doc.channels))
      if (channel.target.instanceId === id && channel.keys.some((k) => k.at > instance.duration))
        return fail("KEYFRAME_RANGE", "Key exceeds instance duration", [id]);
  }
  if (end > doc.settings.duration) {
    if (tx.scope.preserveDuration) return fail("DURATION_CONFLICT", "Edit would extend project duration");
    doc.settings.duration = end;
  }
  doc.revision = document.revision + 1;
  if (!Number.isSafeInteger(doc.revision)) return fail("REVISION_OVERFLOW", "Revision exhausted");
  return ok({
    document: doc,
    inverse: { document: structuredClone(document), expectedContentHash: projectContentHash(doc) },
    affectedIds: [...affected].sort(),
  });
}
