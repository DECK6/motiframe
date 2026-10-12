import { z } from "zod";
import { fail, ok, type Result } from "../../../document/src/result";
import type { ProjectDocument } from "../../../document/src/schema";

const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const rangeSchema = z
  .object({ start: tick, end: tick })
  .refine((r) => r.end > r.start, "Range must have positive duration");
export const recipeIds = [
  "phrase-exchange",
  "anticipation-release",
  "stagger-response",
  "anchor-wipe",
  "match-cut",
  "hold-variation",
] as const;
export const phraseSchema = z.object({
  id: z.string().min(1),
  range: rangeSchema,
  primaryActor: z.string().min(1),
  eventIds: z.array(z.string()),
  grammar: z.enum(recipeIds).optional(),
  actorIds: z.array(z.string()).optional(),
  bases: z.record(z.string(), z.number().finite()).optional(),
});
export const eventSchema = z.object({
  id: z.string().min(1),
  phraseId: z.string(),
  kind: z.enum(["onset", "arrival", "response", "accent", "rest", "prepare", "release"]),
  tick,
  targetIds: z.array(z.string()).min(1),
});
export const roleWindowSchema = z.object({
  id: z.string().min(1),
  range: rangeSchema,
  targetIds: z.array(z.string()).min(1),
  role: z.enum(["reading", "transform", "texture", "tension", "closure"]),
});
export const tensionIntentSchema = z.object({
  id: z.string().min(1),
  cueEvent: z.string(),
  unresolvedState: z.string(),
  releaseEvent: z.string().optional(),
  intentionalUnresolvedEnd: z.boolean(),
});
export const handoffSchema = z.object({
  id: z.string().min(1),
  fromTarget: z.string(),
  toTarget: z.string(),
  at: tick,
  mode: z.enum(["match-cut", "continuous"]),
  preserve: z.array(z.enum(["position", "direction", "shape", "meaning"])),
});
export const scoreSchema = z.object({
  phrases: z.array(phraseSchema),
  events: z.array(eventSchema),
  windows: z.array(roleWindowSchema),
  tensions: z.array(tensionIntentSchema),
  handoffs: z.array(handoffSchema),
});
export type Phrase = z.infer<typeof phraseSchema>;
export type Event = z.infer<typeof eventSchema>;
export type RoleWindow = z.infer<typeof roleWindowSchema>;
export type TensionIntent = z.infer<typeof tensionIntentSchema>;
export type Handoff = z.infer<typeof handoffSchema>;
export type Score = z.infer<typeof scoreSchema>;
export type PhraseRequest = {
  id?: string;
  range: Phrase["range"];
  grammar: string;
  actorIds: string[];
  events: Event[];
  windows: RoleWindow[];
  handoffs: Handoff[];
};
export function validateScore(doc: ProjectDocument): Result<Score> {
  const parsed = scoreSchema.safeParse(doc.score);
  if (!parsed.success)
    return fail(
      "INVALID_SCORE",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  const score = parsed.data;
  const allIds = new Set<string>();
  for (const group of Object.values(score))
    for (const entry of group) {
      if (allIds.has(entry.id)) return fail("DUPLICATE_SCORE_ID", "Score IDs must be unique", [entry.id]);
      allIds.add(entry.id);
    }
  for (const phrase of score.phrases) {
    if (phrase.range.end > doc.settings.duration || !doc.instances[phrase.primaryActor])
      return fail("INVALID_PHRASE", "Phrase range or primary actor is invalid", [phrase.id]);
    for (const id of phrase.eventIds)
      if (!score.events.some((e) => e.id === id && e.phraseId === phrase.id))
        return fail("MISSING_EVENT", "Phrase refers to an unknown event", [phrase.id, id]);
  }
  for (const event of score.events) {
    const phrase = score.phrases.find((p) => p.id === event.phraseId);
    if (
      !phrase ||
      !phrase.eventIds.includes(event.id) ||
      event.tick < phrase.range.start ||
      event.tick > phrase.range.end
    )
      return fail("EVENT_RANGE", "Event must belong to its phrase and range", [event.id]);
    for (const id of event.targetIds)
      if (!doc.instances[id]) return fail("MISSING_ACTOR", "Unknown event actor", [id]);
  }
  for (const window of score.windows) {
    if (window.range.end > doc.settings.duration || window.targetIds.some((id) => !doc.instances[id]))
      return fail("INVALID_ROLE_WINDOW", "Invalid role target or range", [window.id]);
    if (window.role === "reading")
      for (const event of score.events)
        if (
          event.kind !== "rest" &&
          event.tick > window.range.start &&
          event.tick < window.range.end &&
          event.targetIds.some((id) => window.targetIds.includes(id))
        )
          return fail("READING_WINDOW_CONFLICT", "Motion event interrupts a reading window", [
            window.id,
            event.id,
          ]);
  }
  for (const tension of score.tensions) {
    const cue = score.events.find((e) => e.id === tension.cueEvent),
      release = score.events.find((e) => e.id === tension.releaseEvent);
    if (!cue || (tension.releaseEvent && !release) || (release && release.tick < cue.tick))
      return fail("INVALID_TENSION", "Tension events must exist in temporal order", [tension.id]);
    if (!release && !tension.intentionalUnresolvedEnd)
      return fail("UNRESOLVED_TENSION", "Declare an intentional unresolved ending or provide a release", [
        tension.id,
      ]);
  }
  for (const handoff of score.handoffs)
    if (
      !doc.instances[handoff.fromTarget] ||
      !doc.instances[handoff.toTarget] ||
      handoff.at > doc.settings.duration
    )
      return fail("INVALID_HANDOFF", "Handoff actor or time is invalid", [handoff.id]);
  return ok(score);
}
