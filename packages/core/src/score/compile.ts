import { applyTransaction } from "../../../document/src/apply";
import type { EditCommand, EditTransaction } from "../../../document/src/commands";
import { fail, ok, type Result } from "../../../document/src/result";
import type { Keyframe, ProjectDocument } from "../../../document/src/schema";
import { compileProject } from "../compile";
import { evaluateCurve } from "../curves";
import { resolveHandoff } from "./handoff";
import { type Event, type Phrase, validateScore } from "./schema";
export function recipeChannels(grammar: string): string[] {
  return grammar === "anchor-wipe" ? ["clipProgress"] : grammar === "match-cut" ? ["opacity"] : ["x"];
}
function valueFor(grammar: string, event: Event, base: number, primary: boolean): number {
  if (grammar === "match-cut")
    return primary
      ? ["onset", "prepare", "rest"].includes(event.kind)
        ? 1
        : 0
      : ["onset", "prepare", "rest"].includes(event.kind)
        ? 0
        : 1;
  if (grammar === "anchor-wipe" || grammar === "match-cut")
    return ["onset", "prepare", "rest"].includes(event.kind) ? 0 : 1;
  if (grammar === "anticipation-release")
    return (
      base +
      { onset: 0, prepare: -24, accent: 80, release: 80, arrival: 0, response: 16, rest: 0 }[event.kind]
    );
  if (grammar === "hold-variation")
    return (
      base + { onset: 0, prepare: 4, accent: 8, release: 0, arrival: 0, response: 4, rest: 0 }[event.kind]
    );
  if (grammar === "stagger-response")
    return (
      base + { onset: -32, prepare: -40, accent: 0, release: 0, arrival: 0, response: 0, rest: 0 }[event.kind]
    );
  return (
    base + { onset: -48, prepare: -56, accent: 0, release: 48, arrival: 0, response: 16, rest: 0 }[event.kind]
  );
}
export function compileScore(doc: ProjectDocument): Result<EditTransaction> {
  const validated = validateScore(doc);
  if (!validated.ok) return validated;
  const score = validated.value;
  const compiled = compileProject(doc);
  if (!compiled.ok) return compiled;
  const commands: EditCommand[] = [],
    owned = new Map<string, string>(),
    actors = new Set<string>();
  for (const phrase of score.phrases) {
    const grammar = phrase.grammar ?? "phrase-exchange";
    phrase.bases ??= {};
    const events = score.events
      .filter((e) => phrase.eventIds.includes(e.id))
      .sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
    const actorIds = [
      ...new Set([phrase.primaryActor, ...(phrase.actorIds ?? []), ...events.flatMap((e) => e.targetIds)]),
    ];
    for (const actorId of actorIds) {
      const instance = doc.instances[actorId];
      if (!instance) return fail("MISSING_ACTOR", "Unknown phrase actor", [actorId]);
      if (instance.locked || doc.tracks.find((t) => t.id === instance.trackId)?.locked)
        return fail("OWNERSHIP_CONFLICT", "Phrase actor is locked", [actorId]);
      actors.add(actorId);
      const target =
        doc.definitions[instance.definitionId].targets.find((t) => t.key === "root") ??
        doc.definitions[instance.definitionId].targets[0];
      if (!target) return fail("MISSING_TARGET", "Phrase needs a declared wrapper target", [actorId]);
      for (const property of recipeChannels(grammar)) {
        if (!target.channels.includes(property))
          return fail("UNSUPPORTED_RECIPE_CHANNEL", "Recipe channel is not declared", [actorId, property]);
        const found = Object.entries(doc.channels).find(
          ([, c]) =>
            c.target.instanceId === actorId &&
            c.target.targetKey === target.key &&
            c.target.channel === property,
        );
        const id = found?.[0] ?? `${actorId}:${target.key}:${property}`,
          channel = found?.[1];
        if (
          channel &&
          (channel.locked ||
            channel.owner !== "recipe" ||
            (channel.recipeId && channel.recipeId !== phrase.id))
        )
          return fail("OWNERSHIP_CONFLICT", "Recipe conflicts with channel ownership", [id]);
        if (owned.has(id) && owned.get(id) !== phrase.id)
          return fail("OWNERSHIP_CONFLICT", "Two recipes claim one channel", [id]);
        owned.set(id, phrase.id);
        const actorEvents = events.filter((e) => e.targetIds.includes(actorId));
        if (!actorEvents.length) continue;
        const baseKey = `${actorId}:${property}`;
        if (phrase.bases[baseKey] === undefined) {
          const base = channel
            ? evaluateCurve(channel.keys, phrase.range.start - compiled.value.starts[actorId])
            : ok(property === "opacity" ? 1 : 0);
          if (!base.ok) return base;
          if (typeof base.value !== "number")
            return fail("INVALID_RECIPE_VALUE", "Recipe requires numeric values", [id]);
          phrase.bases[baseKey] = base.value;
        }
        const retained =
          channel?.keys.filter(
            (k) =>
              k.at + compiled.value.starts[actorId] < phrase.range.start ||
              k.at + compiled.value.starts[actorId] > phrase.range.end,
          ) ?? [];
        for (const key of channel?.keys ?? [])
          if (!retained.includes(key))
            commands.push({ type: "RemoveKeyframe", channelId: id, keyId: key.id });
        const ticks = new Set<number>();
        for (const event of actorEvents) {
          const at = event.tick - compiled.value.starts[actorId];
          if (!Number.isSafeInteger(at) || at < 0 || at > instance.duration)
            return fail("EVENT_RANGE", "Event is outside actor lifetime", [event.id, actorId]);
          if (ticks.has(at))
            return fail("DUPLICATE_EVENT_TIME", "Two events claim the same actor channel tick", [
              event.id,
              id,
            ]);
          ticks.add(at);
          const key: Keyframe = {
            id: `${phrase.id}:${event.id}:${actorId}:${property}`,
            at,
            value: valueFor(grammar, event, phrase.bases[baseKey], actorId === phrase.primaryActor),
            interpolation: grammar === "match-cut" || event.kind === "rest" ? "hold" : "linear",
          };
          commands.push({
            type: "SetKeyframe",
            channelId: id,
            target: { instanceId: actorId, targetKey: target.key, channel: property },
            owner: "recipe",
            recipeId: phrase.id,
            key,
          });
        }
      }
    }
  }
  const transaction: EditTransaction = {
    id: `score:${doc.revision}`,
    baseRevision: doc.revision,
    author: "recipe",
    scope: {
      instanceIds: [...actors],
      range: { start: 0, end: doc.settings.duration },
      preserveDuration: true,
      ripple: false,
    },
    commands: [{ type: "UpdateScore", score }, ...commands],
  };
  let preview = applyTransaction(doc, transaction);
  if (!preview.ok)
    return preview.error.code === "LOCKED"
      ? fail("OWNERSHIP_CONFLICT", preview.error.message, preview.error.ids)
      : preview;
  for (const handoff of score.handoffs) {
    const resolved = resolveHandoff(preview.value.document, handoff);
    if (!resolved.ok) return resolved;
    transaction.commands.push(...resolved.value.commands.filter((c) => c.type !== "UpdateScore"));
    transaction.scope.instanceIds = [
      ...new Set([...transaction.scope.instanceIds, ...resolved.value.scope.instanceIds]),
    ];
    preview = applyTransaction(doc, transaction);
    if (!preview.ok) return preview;
  }
  return ok(transaction);
}
export type { Phrase };
