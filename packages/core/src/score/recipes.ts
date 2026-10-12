import { applyTransaction } from "../../../document/src/apply";
import type { EditTransaction } from "../../../document/src/commands";
import { fail, ok, type Result } from "../../../document/src/result";
import type { ProjectDocument } from "../../../document/src/schema";
import { compileScore, recipeChannels } from "./compile";
import { resolveHandoff } from "./handoff";
import { type Event, type PhraseRequest, recipeIds } from "./schema";
export const recipes = recipeIds.map((id) => ({
  id,
  channels: recipeChannels(id),
  props: [],
  timingRoles:
    id === "anticipation-release"
      ? ["prepare", "release", "response"]
      : id === "hold-variation"
        ? ["onset", "rest", "response"]
        : ["onset", "accent", "response"],
  conditions: ["Declared wrapper channels", "Recipe ownership", "Events inside actor lifetime"],
  counterexamples:
    id === "anchor-wipe"
      ? ["The result is already visible before the cue"]
      : id === "match-cut"
        ? ["A continuous transformation requires intermediate states"]
        : ["Do not interrupt an active reading window"],
}));
function defaultEvents(request: PhraseRequest, id: string): Event[] {
  const length = request.range.end - request.range.start;
  if (request.grammar === "match-cut")
    return request.actorIds.flatMap((actor, index) => [
      {
        id: `${id}:${actor}:before`,
        phraseId: id,
        kind: index === 0 ? ("onset" as const) : ("prepare" as const),
        tick: request.range.start,
        targetIds: [actor],
      },
      {
        id: `${id}:${actor}:cut`,
        phraseId: id,
        kind: index === 0 ? ("release" as const) : ("arrival" as const),
        tick: request.range.start + Math.round(length / 2),
        targetIds: [actor],
      },
    ]);
  return request.actorIds.flatMap((actor, index) => {
    const delay =
      request.grammar === "stagger-response"
        ? Math.round((length * 0.12 * index) / Math.max(1, request.actorIds.length - 1))
        : index === 0
          ? 0
          : Math.round(length * 0.1);
    const kinds: Event["kind"][] =
      request.grammar === "anticipation-release"
        ? ["prepare", "release", "response"]
        : request.grammar === "hold-variation"
          ? ["onset", "rest", "response"]
          : ["onset", "accent", "response"];
    return kinds.map((kind, n) => ({
      id: `${id}:${actor}:${kind}`,
      phraseId: id,
      kind,
      tick: request.range.start + Math.min(length, Math.round(length * [0, 0.45, 0.8][n]) + delay),
      targetIds: [actor],
    }));
  });
}
export function planPhrase(doc: ProjectDocument, request: PhraseRequest): Result<EditTransaction> {
  if (!recipeIds.includes(request.grammar as (typeof recipeIds)[number]))
    return fail("UNKNOWN_RECIPE", "Unknown phrase grammar");
  if (!request.actorIds.length) return fail("MISSING_ACTOR", "Select at least one actor");
  const id = request.id ?? `phrase-${doc.revision}-${request.actorIds.join("-")}`;
  const events = request.events.length ? request.events : defaultEvents(request, id);
  const phrase = {
    id,
    range: request.range,
    primaryActor: request.actorIds[0],
    actorIds: request.actorIds,
    eventIds: events.map((e) => e.id),
    grammar: request.grammar as (typeof recipeIds)[number],
  };
  if (doc.score.phrases.some((p) => p && typeof p === "object" && !Array.isArray(p) && p.id === id))
    return fail("DUPLICATE_SCORE_ID", "Phrase already exists", [id]);
  const candidate = structuredClone(doc);
  candidate.score = {
    phrases: [phrase],
    events,
    windows: request.windows,
    tensions: [],
    handoffs: request.handoffs,
  };
  const compiled = compileScore(candidate);
  if (!compiled.ok) return compiled;
  const transaction = compiled.value;
  const scoreCommand = transaction.commands[0];
  if (scoreCommand.type !== "UpdateScore") return fail("INVALID_SCORE", "Missing compiled score");
  scoreCommand.score = {
    phrases: [...doc.score.phrases, ...(scoreCommand.score.phrases ?? [])],
    events: [...doc.score.events, ...events],
    windows: [...doc.score.windows, ...request.windows],
    tensions: doc.score.tensions,
    handoffs: [...doc.score.handoffs, ...request.handoffs],
  };
  let preview = applyTransaction(doc, transaction);
  if (!preview.ok) return preview;
  for (const handoff of request.handoffs) {
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
export type { PhraseRequest };
