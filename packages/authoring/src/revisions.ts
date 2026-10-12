import type { ProjectDocument } from "../../document/src/schema";
/** Manifest IDs remain stable; registry/map keys select one immutable revision. */
export function definitionKey(id: string, revision: number): string {
  return `${id}@${revision}`;
}
export function resolveDefinitionKey(doc: ProjectDocument, id: string, revision: number): string | undefined {
  if (doc.definitions[id]?.revision === revision) return id;
  const canonical = definitionKey(id, revision);
  return doc.definitions[canonical]?.revision === revision ? canonical : undefined;
}
