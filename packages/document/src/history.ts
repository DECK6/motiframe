import { applyTransaction, projectContentHash } from "./apply";
import type { EditTransaction, TransactionInverse } from "./commands";
import { fail, ok, type Result } from "./result";
import type { ProjectDocument } from "./schema";
export type HistoryEntry = TransactionInverse & { gestureId?: string };
export type HistoryState = { document: ProjectDocument; past: HistoryEntry[]; future: HistoryEntry[] };
export function createHistory(document: ProjectDocument): HistoryState {
  return { document: structuredClone(document), past: [], future: [] };
}
export function commitHistory(
  state: HistoryState,
  tx: EditTransaction,
  options: { gestureId?: string } = {},
): Result<HistoryState> {
  const result = applyTransaction(state.document, tx);
  if (!result.ok) return result;
  const past = [...state.past],
    entry = { ...result.value.inverse, ...options };
  if (options.gestureId && past.at(-1)?.gestureId === options.gestureId)
    past[past.length - 1] = { ...past[past.length - 1], expectedContentHash: entry.expectedContentHash };
  else past.push(entry);
  return ok({ document: result.value.document, past, future: [] });
}
function restore(state: HistoryState, direction: "undo" | "redo"): Result<HistoryState> {
  const source = direction === "undo" ? state.past : state.future,
    entry = source.at(-1);
  if (!entry) return fail("EMPTY_HISTORY", `Nothing to ${direction}`);
  if (projectContentHash(state.document) !== entry.expectedContentHash)
    return fail("HISTORY_CONFLICT", "History no longer matches the current document");
  const document = structuredClone(entry.document);
  document.revision = state.document.revision + 1;
  const back = {
    document: structuredClone(state.document),
    expectedContentHash: projectContentHash(document),
  };
  return ok(
    direction === "undo"
      ? { document, past: source.slice(0, -1), future: [...state.future, back] }
      : { document, past: [...state.past, back], future: source.slice(0, -1) },
  );
}
export function undo(state: HistoryState): Result<HistoryState> {
  return restore(state, "undo");
}
export function redo(state: HistoryState): Result<HistoryState> {
  return restore(state, "redo");
}
export { projectContentHash };
