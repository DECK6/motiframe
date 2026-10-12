import bundled from "../data/motion-ontology.json";
import type { KnowledgeSnapshot } from "./schema";

export type * from "./schema";

function freeze(value: object): void {
  for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
  Object.freeze(value);
}
const snapshot = bundled as unknown as KnowledgeSnapshot;
freeze(snapshot);
/** Portable facts and reference metadata only. No private media is bundled. */
export function loadBundledKnowledge(): KnowledgeSnapshot {
  return snapshot;
}
export { queryKnowledge } from "./query";
