import { applyTransaction } from "../../document/src/apply";
import type { EditTransaction } from "../../document/src/commands";
import {
  type DefinitionMetadata,
  type DefinitionMigration,
  type DefinitionRef,
  inspectDefinitionRevision,
} from "../../document/src/definition-commands";
import { ok, type Result } from "../../document/src/result";
import type { ProjectDocument } from "../../document/src/schema";
import { resolveDefinitionKey } from "./revisions";
export type ReconcileOptions = { instanceIds?: string[]; targetRemap?: Record<string, string> };
function selection(doc: ProjectDocument, oldRef: DefinitionRef, options: ReconcileOptions): string[] {
  const oldKey = resolveDefinitionKey(doc, oldRef.definitionId, oldRef.revision);
  return (
    options.instanceIds ??
    oldRef.instanceIds ??
    Object.entries(doc.instances)
      .filter(([, i]) => i.definitionId === oldKey && i.definitionRevision === oldRef.revision)
      .map(([id]) => id)
  );
}
export function inspectDefinitionMigration(
  doc: ProjectDocument,
  oldRef: DefinitionRef,
  artifact: DefinitionMetadata,
  options: ReconcileOptions = {},
): Result<DefinitionMigration> {
  return inspectDefinitionRevision(doc, {
    type: "ApplyDefinitionRevision",
    oldRef,
    artifact,
    instanceIds: selection(doc, oldRef, options),
    targetRemap: options.targetRemap,
  });
}
export function reconcileDefinition(
  doc: ProjectDocument,
  oldRef: DefinitionRef,
  artifact: DefinitionMetadata,
  options: ReconcileOptions = {},
): Result<DefinitionMigration> {
  const instanceIds = selection(doc, oldRef, options);
  const tx: EditTransaction = {
    id: `definition:${artifact.manifest.id}:${artifact.manifest.revision}`,
    baseRevision: doc.revision,
    author: "user",
    scope: {
      instanceIds,
      range: { start: 0, end: doc.settings.duration },
      preserveDuration: true,
      ripple: false,
    },
    commands: [
      {
        type: "ApplyDefinitionRevision",
        oldRef,
        artifact: { manifest: artifact.manifest, moduleHash: artifact.moduleHash },
        instanceIds,
        targetRemap: options.targetRemap,
      },
    ],
  };
  const applied = applyTransaction(doc, tx);
  if (!applied.ok) return applied;
  return ok({ document: applied.value.document, orphanTargets: [], migrationRequired: false });
}
export type { DefinitionMetadata, DefinitionMigration, DefinitionRef };
