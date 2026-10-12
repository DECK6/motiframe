import { definitionKey, resolveDefinitionKey } from "../../authoring/src/revisions";
import { compileProject } from "../../core/src/compile";
import { fail, ok, type Result } from "./result";
import {
  type ElementManifest,
  type JsonValue,
  manifestSchema,
  type ProjectDocument,
  type TargetAddress,
} from "./schema";
export type DefinitionRef = { definitionId: string; revision: number; instanceIds?: string[] };
export type DefinitionMetadata = { manifest: ElementManifest; moduleHash: string };
export type DefinitionRevisionCommand = {
  type: "ApplyDefinitionRevision";
  oldRef: DefinitionRef;
  artifact: DefinitionMetadata;
  instanceIds: string[];
  targetRemap?: Record<string, string>;
};
export type DefinitionMigration = {
  document: ProjectDocument;
  orphanTargets: TargetAddress[];
  migrationRequired: boolean;
};
function compatible(value: JsonValue, schema: unknown): boolean {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return true;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.enum) && !s.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) return false;
  if (s.type === "string") return typeof value === "string";
  if (s.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (s.type === "integer") return typeof value === "number" && Number.isSafeInteger(value);
  if (s.type === "boolean") return typeof value === "boolean";
  if (s.type === "array") return Array.isArray(value) && value.every((v) => compatible(v, s.items));
  if (s.type === "object" || s.properties) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const properties = (s.properties ?? {}) as Record<string, unknown>;
    if (Array.isArray(s.required) && s.required.some((k) => typeof k === "string" && !(k in value)))
      return false;
    return Object.entries(value).every(([key, v]) =>
      s.additionalProperties === false && !(key in properties) ? false : compatible(v, properties[key]),
    );
  }
  return true;
}
export function inspectDefinitionRevision(
  doc: ProjectDocument,
  command: DefinitionRevisionCommand,
): Result<DefinitionMigration> {
  const parsed = manifestSchema.safeParse(command.artifact?.manifest);
  if (!parsed.success) return fail("INVALID_MANIFEST", "New definition manifest is invalid");
  const manifest = parsed.data,
    oldKey = resolveDefinitionKey(doc, command.oldRef.definitionId, command.oldRef.revision);
  if (!oldKey)
    return fail("DEFINITION_REVISION", "Old definition revision is unavailable", [
      command.oldRef.definitionId,
    ]);
  const previous = doc.definitions[oldKey];
  if (
    manifest.id !== previous.id ||
    manifest.revision <= previous.revision ||
    !command.artifact.moduleHash ||
    manifest.moduleHash !== command.artifact.moduleHash
  )
    return fail(
      "DEFINITION_REVISION",
      "New artifact must retain definition identity, advance revision, and match its module hash",
      [manifest.id],
    );
  const key = definitionKey(manifest.id, manifest.revision),
    existing = doc.definitions[key];
  if (existing && JSON.stringify(existing) !== JSON.stringify(manifest))
    return fail("DEFINITION_REVISION", "A published revision cannot be replaced by different content", [key]);
  if (!command.instanceIds.length) return fail("MISSING_INSTANCE", "Select instances to migrate");
  const next = structuredClone(doc),
    orphanTargets: TargetAddress[] = [];
  for (const id of command.instanceIds) {
    const instance = next.instances[id];
    if (
      !instance ||
      instance.definitionId !== oldKey ||
      instance.definitionRevision !== command.oldRef.revision
    )
      return fail("DEFINITION_REVISION", "Selected instance does not use the expected revision", [id]);
    if (instance.locked || next.tracks.find((t) => t.id === instance.trackId)?.locked)
      return fail("LOCKED", "Cannot migrate a locked instance", [id]);
    if (!compatible(instance.props, manifest.propsSchema))
      return fail("PROPS_MIGRATION_REQUIRED", "Existing props are incompatible with the new definition", [
        id,
      ]);
    for (const channel of Object.values(next.channels))
      if (channel.target.instanceId === id) {
        const mapped = command.targetRemap?.[channel.target.targetKey] ?? channel.target.targetKey,
          target = manifest.targets.find((t) => t.key === mapped);
        if (!target?.channels.includes(channel.target.channel)) {
          orphanTargets.push({ ...channel.target });
          continue;
        }
        if (mapped !== channel.target.targetKey) {
          if (channel.locked)
            return fail("LOCKED", "Cannot remap a locked channel", [id, channel.target.targetKey]);
          channel.target.targetKey = mapped;
        }
      }
    for (const [childId, child] of Object.entries(next.instances))
      if (child.parentId === id && !manifest.slots.some((s) => s.id === child.slotId))
        return fail("SLOT_MIGRATION_REQUIRED", "A live child slot was removed", [id, childId]);
    instance.definitionId = key;
    instance.definitionRevision = manifest.revision;
  }
  next.definitions[key] = manifest;
  if (!orphanTargets.length) {
    const compiled = compileProject(next);
    if (!compiled.ok) return compiled;
  }
  return ok({ document: next, orphanTargets, migrationRequired: orphanTargets.length > 0 });
}
export function applyDefinitionRevision(
  doc: ProjectDocument,
  command: DefinitionRevisionCommand,
): Result<DefinitionMigration> {
  const result = inspectDefinitionRevision(doc, command);
  if (!result.ok) return result;
  if (result.value.migrationRequired)
    return fail(
      "TARGET_MIGRATION_REQUIRED",
      "New targets require explicit remapping before this revision can be applied",
      result.value.orphanTargets.map((t) => `${t.instanceId}:${t.targetKey}:${t.channel}`),
    );
  return result;
}
