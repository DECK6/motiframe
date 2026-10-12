import { fail, ok, type Result } from "../../document/src/result";
import { type ProjectDocument, parseProject } from "../../document/src/schema";
import { evaluateCurve } from "./curves";
export type MotionIR = {
  document: ProjectDocument;
  documentRevision: number;
  duration: number;
  order: string[];
  starts: Record<string, number>;
};
export function compileProject(input: unknown): Result<MotionIR> {
  const parsed = parseProject(input);
  if (!parsed.ok) return parsed;
  const doc = parsed.value;
  const ids = new Set<string>(),
    tracks = new Set<string>(),
    order: string[] = [];
  for (const track of doc.tracks) {
    if (tracks.has(track.id)) return fail("DUPLICATE_ID", "Duplicate track", [track.id]);
    tracks.add(track.id);
    for (const id of track.instanceIds) {
      if (ids.has(id)) return fail("DUPLICATE_ID", "Instance belongs to multiple track positions", [id]);
      if (!doc.instances[id]) return fail("MISSING_INSTANCE", "Track refers to an unknown instance", [id]);
      if (doc.instances[id].trackId !== track.id)
        return fail("TRACK_MISMATCH", "Instance and track disagree", [id]);
      ids.add(id);
      order.push(id);
    }
  }
  if (ids.size !== Object.keys(doc.instances).length)
    return fail("ORPHAN_INSTANCE", "Every instance must belong to a track");
  const starts: Record<string, number> = {};
  const visiting = new Set<string>();
  const visit = (id: string): Result<number> => {
    if (starts[id] !== undefined) return ok(starts[id]);
    if (visiting.has(id)) return fail("PARENT_CYCLE", "Parent cycle", [id]);
    const instance = doc.instances[id];
    if (!instance) return fail("MISSING_PARENT", "Unknown parent", [id]);
    visiting.add(id);
    const definition = doc.definitions[instance.definitionId];
    if (!definition || definition.revision !== instance.definitionRevision)
      return fail("DEFINITION_REVISION", "Missing definition revision", [id]);
    let parentStart = 0;
    if (instance.parentId) {
      const result = visit(instance.parentId);
      if (!result.ok) return result;
      parentStart = result.value;
    } else {
      const scenes = Object.values(doc.scenes).filter((s) => s.rootIds.includes(id));
      if (scenes.length !== 1) return fail("SCENE_ROOT", "Each root belongs to exactly one scene", [id]);
      parentStart = scenes[0].start;
    }
    const start = parentStart + instance.start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(start + instance.duration))
      return fail("TIME_OVERFLOW", "Timeline exceeds integer precision", [id]);
    starts[id] = start;
    visiting.delete(id);
    return ok(start);
  };
  for (const id of order) {
    const result = visit(id);
    if (!result.ok) return result;
  }
  const keyIds = new Set<string>();
  const addresses = new Set<string>();
  for (const channel of Object.values(doc.channels)) {
    const { target } = channel;
    const instance = doc.instances[target.instanceId];
    if (!instance) return fail("ORPHAN_CHANNEL", "Unknown channel instance", [target.instanceId]);
    const address = JSON.stringify(target);
    if (addresses.has(address)) return fail("DUPLICATE_CHANNEL", "Multiple channels own one target property");
    addresses.add(address);
    const targetSpec = doc.definitions[instance.definitionId].targets.find((t) => t.key === target.targetKey);
    if (!targetSpec?.channels.includes(target.channel))
      return fail("UNKNOWN_TARGET", "Target or channel is not declared", [
        target.instanceId,
        target.targetKey,
        target.channel,
      ]);
    for (const key of channel.keys) {
      if (keyIds.has(key.id)) return fail("DUPLICATE_ID", "Duplicate key ID", [key.id]);
      keyIds.add(key.id);
    }
    const check = evaluateCurve(channel.keys, 0);
    if (!check.ok) return check;
    for (let i = 0; i < channel.keys.length - 1; i++) {
      const a = channel.keys[i],
        b = channel.keys[i + 1];
      const check = evaluateCurve(channel.keys, (a.at + b.at) / 2);
      if (!check.ok) return check;
    }
  }
  return ok({
    document: doc,
    documentRevision: doc.revision,
    duration: doc.settings.duration,
    order,
    starts,
  });
}
