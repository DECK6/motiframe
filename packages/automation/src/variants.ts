import { applyTransaction, projectContentHash } from "../../document/src/apply";
import { type EditTransaction, editTransactionSchema } from "../../document/src/commands";
import { fail, ok, type Result } from "../../document/src/result";
import type { ProjectDocument } from "../../document/src/schema";

export type Variant = {
  readonly id: string;
  readonly baseRevision: number;
  readonly document: ProjectDocument;
  readonly label: string;
};
function freeze(value: object): void {
  for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
  Object.freeze(value);
}
/** Builds a comparison candidate only. Acceptance must submit the original transaction to the writer. */
export function createVariant(
  document: ProjectDocument,
  transaction: EditTransaction,
  label = "비교안 B",
): Result<Variant> {
  const parsed = editTransactionSchema.safeParse(transaction);
  if (!parsed.success) return fail("INVALID_TRANSACTION", parsed.error.message);
  const changed = applyTransaction(document, parsed.data);
  if (!changed.ok) return changed;
  const variant: Variant = {
    id: `variant:${document.id}:${document.revision}:${projectContentHash(changed.value.document)}`,
    baseRevision: document.revision,
    document: changed.value.document,
    label,
  };
  freeze(variant);
  return ok(variant);
}
