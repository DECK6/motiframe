import { applyTransaction } from "../../document/src/apply";
import { type EditScope, type EditTransaction, editTransactionSchema } from "../../document/src/commands";
import { fail, ok, type Result } from "../../document/src/result";
import type { ProjectDocument } from "../../document/src/schema";
import type { EvidencePacket } from "../../knowledge/src/schema";
export type ChangeSet = {
  protocolVersion: 1;
  requestId: string;
  baseRevision: number;
  transaction: EditTransaction;
  explanation: string;
  evidenceRefs: string[];
};
export function parseChangeSet(input: unknown): Result<ChangeSet> {
  if (!input || typeof input !== "object") return fail("INVALID_CHANGE_SET", "ChangeSet must be an object");
  const change = input as ChangeSet;
  if (
    change.protocolVersion !== 1 ||
    typeof change.requestId !== "string" ||
    typeof change.explanation !== "string" ||
    !Array.isArray(change.evidenceRefs) ||
    !change.evidenceRefs.every((x) => typeof x === "string") ||
    !change.transaction
  )
    return fail("INVALID_CHANGE_SET", "ChangeSet protocol or fields are invalid");
  const tx = editTransactionSchema.safeParse(change.transaction);
  if (!tx.success) return fail("INVALID_TRANSACTION", tx.error.message);
  if (change.requestId !== change.transaction.id)
    return fail("INVALID_REQUEST_ID", "requestId must equal transaction.id");
  return ok(change);
}
export function validateChangeSet(doc: ProjectDocument, input: unknown): Result<EditTransaction> {
  const parsed = parseChangeSet(input);
  if (!parsed.ok) return parsed;
  const change = parsed.value;
  if (change.baseRevision !== doc.revision || change.transaction.baseRevision !== doc.revision)
    return fail("REVISION_CONFLICT", "Refresh context before applying a proposal");
  if (change.transaction.author !== "agent")
    return fail("INVALID_AUTHOR", "External proposals must identify author=agent");
  try {
    const applied = applyTransaction(doc, change.transaction);
    return applied.ok ? ok(change.transaction) : applied;
  } catch (error) {
    return fail("INVALID_CHANGE_SET", String(error));
  }
}
export function getContext(doc: ProjectDocument, scope: EditScope, evidence: EvidencePacket) {
  const ids = new Set(scope.instanceIds);
  return {
    protocolVersion: 1 as const,
    documentRevision: doc.revision,
    scope,
    locks: {
      instances: Object.entries(doc.instances)
        .filter(([, i]) => i.locked)
        .map(([id]) => id),
      channels: Object.entries(doc.channels)
        .filter(([, c]) => c.locked || c.owner === "manual")
        .map(([id, c]) => ({ id, owner: c.owner, locked: c.locked })),
    },
    selectedContent: {
      instances: Object.fromEntries(Object.entries(doc.instances).filter(([id]) => ids.has(id))),
      channels: Object.fromEntries(
        Object.entries(doc.channels).filter(([, c]) => ids.has(c.target.instanceId)),
      ),
      definitions: doc.definitions,
      settings: doc.settings,
    },
    neighbourHandoffs: doc.score.handoffs,
    skillVersion: "0.1.0",
    evidence,
  };
}
