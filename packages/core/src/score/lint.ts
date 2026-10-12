import type { ProjectDocument } from "../../../document/src/schema";
import { compileProject } from "../compile";
import { scoreSchema } from "./schema";
export type ScoreIssue = {
  id: string;
  range: { start: number; end: number };
  code: string;
  severity: "info" | "warning";
  message: string;
};
export function lintScore(doc: ProjectDocument): ScoreIssue[] {
  const result = scoreSchema.safeParse(doc.score),
    issues: ScoreIssue[] = [];
  const whole = { start: 0, end: doc.settings.duration };
  if (!result.success)
    return [
      {
        id: "score:invalid",
        range: whole,
        code: "INVALID_SCORE",
        severity: "warning",
        message: "The score contains malformed entries.",
      },
    ];
  const score = result.data,
    compiled = compileProject(doc);
  if (!compiled.ok)
    return [
      {
        id: "project:invalid",
        range: whole,
        code: compiled.error.code,
        severity: "warning",
        message: compiled.error.message,
      },
    ];
  for (const [id, instance] of Object.entries(doc.instances)) {
    const start = compiled.value.starts[id],
      end = start + instance.duration;
    const channels = Object.values(doc.channels).filter((c) => c.target.instanceId === id);
    const still = channels.every(
      (c) =>
        c.keys.every((k) => JSON.stringify(k.value) === JSON.stringify(c.keys[0]?.value)) &&
        c.keys.every((k) => !k.out && !k.in),
    );
    const roles = score.windows
      .filter((w) => w.targetIds.includes(id))
      .map((w) => w.range)
      .sort((a, b) => a.start - b.start);
    let cursor = start;
    for (const role of roles) if (role.start <= cursor) cursor = Math.max(cursor, role.end);
    if (still && instance.duration >= 480000 && cursor < end)
      issues.push({
        id: `${id}:hold`,
        range: { start: Math.max(start, cursor), end },
        code: "HOLD_WITHOUT_ROLE",
        severity: "warning",
        message: "A long still interval has no reading, tension, texture, or closure role.",
      });
  }
  for (const reading of score.windows.filter((w) => w.role === "reading"))
    for (const transform of score.windows.filter((w) => w.role === "transform"))
      if (
        reading.targetIds.some((id) => transform.targetIds.includes(id)) &&
        Math.max(reading.range.start, transform.range.start) <
          Math.min(reading.range.end, transform.range.end)
      )
        issues.push({
          id: `${reading.id}:${transform.id}`,
          range: {
            start: Math.max(reading.range.start, transform.range.start),
            end: Math.min(reading.range.end, transform.range.end),
          },
          code: "READING_TRANSFORM_OVERLAP",
          severity: "warning",
          message: "Reading and transformation roles overlap on the same actor.",
        });
  for (const tension of score.tensions)
    if (!tension.releaseEvent && !tension.intentionalUnresolvedEnd) {
      const cue = score.events.find((e) => e.id === tension.cueEvent);
      issues.push({
        id: `${tension.id}:unresolved`,
        range: { start: cue?.tick ?? 0, end: doc.settings.duration },
        code: "UNDECLARED_UNRESOLVED_END",
        severity: "warning",
        message: "Declare whether this unresolved ending is intentional.",
      });
    }
  for (const phrase of score.phrases) {
    const events = score.events.filter((e) => phrase.eventIds.includes(e.id)),
      primary = events.find(
        (e) => e.targetIds.includes(phrase.primaryActor) && ["accent", "arrival", "release"].includes(e.kind),
      );
    if (primary)
      for (const event of events)
        if (
          event.kind === "accent" &&
          !event.targetIds.includes(phrase.primaryActor) &&
          event.tick <= primary.tick
        )
          issues.push({
            id: `${event.id}:hierarchy`,
            range: { start: event.tick, end: Math.min(doc.settings.duration, event.tick + 8000) },
            code: "SUPPORT_PRECEDES_PRIMARY",
            severity: "warning",
            message:
              "A supporting accent precedes or coincides with the primary action; review the intended hierarchy.",
          });
  }
  return issues;
}
