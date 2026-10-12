import type { EditCommand, EditTransaction } from "../../../document/src/commands";
import { fail, ok, type Result } from "../../../document/src/result";
import type { Channel, ProjectDocument } from "../../../document/src/schema";
import { compileProject } from "../compile";
import { evaluateCurve } from "../curves";
import { type Handoff, handoffSchema } from "./schema";
export function resolveHandoff(doc: ProjectDocument, input: Handoff): Result<EditTransaction> {
  const parsed = handoffSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_HANDOFF", "Malformed handoff");
  const h = parsed.data;
  const compiled = compileProject(doc);
  if (!compiled.ok) return compiled;
  if (!doc.instances[h.fromTarget] || !doc.instances[h.toTarget])
    return fail("MISSING_ACTOR", "Handoff actors must exist", [h.fromTarget, h.toTarget]);
  const handoffs = doc.score.handoffs
    .filter((v) => v && typeof v === "object" && !Array.isArray(v) && v.id !== h.id)
    .map((v) => handoffSchema.safeParse(v))
    .filter((v) => v.success)
    .map((v) => v.data!);
  handoffs.push(h);
  const visit = (id: string, path: Set<string>): boolean => {
    if (path.has(id)) return false;
    const next = new Set(path);
    next.add(id);
    return handoffs.filter((v) => v.fromTarget === id).every((v) => visit(v.toTarget, next));
  };
  if (!visit(h.fromTarget, new Set())) return fail("HANDOFF_CYCLE", "Handoffs cannot form a cycle", [h.id]);
  if (h.preserve.some((p) => p !== "position"))
    return fail(
      "UNSUPPORTED_HANDOFF_PRESERVATION",
      "Only measured wrapper position preservation is currently available",
      [h.id],
    );
  const channel = (id: string, property: string): [string, Channel] | undefined =>
    Object.entries(doc.channels).find(
      ([, c]) => c.target.instanceId === id && c.target.targetKey === "root" && c.target.channel === property,
    );
  const sample = (id: string, property: string, tick: number): Result<number> => {
    const c = channel(id, property)?.[1];
    if (!c) return ok(property.startsWith("scale") ? 1 : 0);
    const v = evaluateCurve(c.keys, tick - compiled.value.starts[id]);
    return v.ok && typeof v.value === "number"
      ? ok(v.value)
      : fail("INVALID_HANDOFF_CHANNEL", "Position must be numeric", [id, property]);
  };
  const parentOffset = (id: string): Result<[number, number]> => {
    const parent = doc.instances[id].parentId;
    if (!parent) return ok([0, 0]);
    for (const property of ["rotateX", "rotateY", "rotateZ", "perspective", "scaleX", "scaleY"]) {
      const value = sample(parent, property, h.at);
      if (!value.ok) return value;
      if (value.value !== (property.startsWith("scale") ? 1 : 0))
        return fail("PROJECTED_HANDOFF_REQUIRED", "Transformed parents require measured projected bounds", [
          id,
          parent,
        ]);
    }
    const x = sample(parent, "x", h.at),
      y = sample(parent, "y", h.at),
      ancestor = parentOffset(parent);
    if (!x.ok) return x;
    if (!y.ok) return y;
    if (!ancestor.ok) return ancestor;
    return ok([x.value + ancestor.value[0], y.value + ancestor.value[1]]);
  };
  const from = parentOffset(h.fromTarget),
    to = parentOffset(h.toTarget);
  if (!from.ok) return from;
  if (!to.ok) return to;
  const commands: EditCommand[] = [];
  for (const [axis, property] of ["x", "y"].entries()) {
    const source = sample(h.fromTarget, property, h.at);
    if (!source.ok) return source;
    const found = channel(h.toTarget, property),
      id = found?.[0] ?? `${h.toTarget}:root:${property}`,
      existing = found?.[1];
    const instance = doc.instances[h.toTarget],
      local = h.at - compiled.value.starts[h.toTarget];
    if (local < 0 || local > instance.duration)
      return fail("EVENT_RANGE", "Handoff is outside destination lifetime", [h.id]);
    if (
      instance.locked ||
      doc.tracks.find((t) => t.id === instance.trackId)?.locked ||
      existing?.locked ||
      existing?.owner === "manual"
    )
      return fail("OWNERSHIP_CONFLICT", "Handoff destination is manual or locked", [id]);
    if (
      !doc.definitions[instance.definitionId].targets.some(
        (t) => t.key === "root" && t.channels.includes(property),
      )
    )
      return fail("MISSING_TARGET", "Handoff needs declared root position channels", [id]);
    if (
      h.mode === "continuous" &&
      (!existing?.keys.some((k) => k.at < local && k.interpolation !== "hold") ||
        !existing.keys.some((k) => k.at > local))
    )
      return fail(
        "MISSING_CONTINUOUS_STATE",
        "Continuous handoff needs motion states before and after the cue",
        [h.id, id],
      );
    const atKey = existing?.keys.find((k) => k.at === local);
    commands.push({
      type: "SetKeyframe",
      channelId: id,
      target: { instanceId: h.toTarget, targetKey: "root", channel: property },
      owner: "recipe",
      recipeId: existing?.recipeId ?? h.id,
      key: {
        id: atKey?.id ?? `${h.id}:${property}`,
        at: local,
        value: source.value + from.value[axis] - to.value[axis],
        interpolation: h.mode === "match-cut" ? "hold" : "linear",
      },
    });
  }
  commands.push({ type: "UpdateScore", score: { handoffs } });
  return ok({
    id: `handoff:${h.id}:${doc.revision}`,
    baseRevision: doc.revision,
    author: "recipe",
    scope: {
      instanceIds: [h.fromTarget, h.toTarget],
      range: { start: 0, end: doc.settings.duration },
      preserveDuration: true,
      ripple: false,
    },
    commands,
  });
}
