import { createHash } from "node:crypto";
import { fail, ok, type Result } from "../../document/src/result";
import { resolveImage } from "./assets";
import type {
  AssetMap,
  EvidenceClass,
  JsonValue,
  KnowledgeNode,
  KnowledgeRelation,
  KnowledgeSnapshot,
} from "./schema";

const classes: EvidenceClass[] = ["observation", "measurement", "creator_statement", "interpretation"];
// Raw vault documents, execution instructions and media paths are intentionally outside the portable projection.
const nodeFields = new Set(
  `id type label definition purpose apply_when counterexamples dimension_variants verification source_section legacy_case_ids source_ids distinctions implementation_ids representative_scene_ids evidence_status scene_ids scene_id work_id time_range image_ids concept_ids observations spatial_relations sampled_change axes avoid_when evidence_limits dimension_evidence review measurement appearance static_vs_temporal kind evidence_class claim_domain value identity_scope award creator creator_url project_url source_url summary evidence_level evidence_source_ids legacy_case_id year reference_priority maps_to_case_ids maps_to_technique_ids license version role renderer limits scope_note limitations coverage`.split(
    " ",
  ),
);
const sourceFields = new Set(
  `id title canonicalUrl creatorPublisher publicationVersion accessedAt sourceClass accessStatus evidenceMode relevantExcerpt sectionLocator supportedTechniqueIds supportedCaseIds limitations`.split(
    " ",
  ),
);
const omitFields = new Set(["sidecar", "source_record", "coverage_sources", "honors_source"]);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function portable(value: unknown): JsonValue {
  if (typeof value === "string")
    return value.replace(
      /(?:\/(?:Users|Volumes|home|private|tmp)\/|[A-Za-z]:\\)[^\s"'<>]+/g,
      "[local-path omitted]",
    );
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(portable);
  if (object(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !omitFields.has(key))
        .map(([key, child]) => [key, portable(child)]),
    );
  return null;
}
const hash = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");

/** Source JSON text preserves the exact source-file hash; an object uses its JSON serialization hash. */
export function importOntology(input: unknown, assetMap: AssetMap = {}): Result<KnowledgeSnapshot> {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return fail("INVALID_ONTOLOGY", "Ontology must be valid JSON");
    }
  }
  if (!object(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.relations))
    return fail("INVALID_ONTOLOGY", "Ontology requires nodes and relations");
  const ids = new Set<string>();
  const rawNodes: KnowledgeNode[] = [];
  for (const node of raw.nodes) {
    if (
      !object(node) ||
      typeof node.id !== "string" ||
      !node.id ||
      typeof node.type !== "string" ||
      typeof node.label !== "string"
    )
      return fail("INVALID_ONTOLOGY", "Node requires id, type and label");
    if (ids.has(node.id)) return fail("DUPLICATE_ID", "Node IDs must be unique", [node.id]);
    if (node.evidence_class !== undefined && !classes.includes(node.evidence_class as EvidenceClass))
      return fail("INVALID_EVIDENCE_CLASS", "Unknown evidence class", [node.id]);
    ids.add(node.id);
    rawNodes.push(node as KnowledgeNode);
  }
  const relationIds = new Set<string>();
  const relations: KnowledgeRelation[] = [];
  for (const relation of raw.relations) {
    if (
      !object(relation) ||
      typeof relation.id !== "string" ||
      typeof relation.from !== "string" ||
      typeof relation.to !== "string" ||
      typeof relation.type !== "string"
    )
      return fail("INVALID_ONTOLOGY", "Relation requires id, from, to and type");
    if (relationIds.has(relation.id))
      return fail("DUPLICATE_ID", "Relation IDs must be unique", [relation.id]);
    if (!ids.has(relation.from) || !ids.has(relation.to))
      return fail("DANGLING_REFERENCE", "Relation endpoint does not exist", [relation.id]);
    if (relation.evidence_class !== undefined && !classes.includes(relation.evidence_class as EvidenceClass))
      return fail("INVALID_EVIDENCE_CLASS", "Unknown evidence class", [relation.id]);
    relationIds.add(relation.id);
    relations.push(portable(relation) as KnowledgeRelation);
  }
  const nodes = rawNodes.map((node) => {
    const value = portable(
      Object.fromEntries(Object.entries(node).filter(([key]) => nodeFields.has(key))),
    ) as KnowledgeNode;
    if (object(node.record))
      value.record = portable(
        Object.fromEntries(Object.entries(node.record).filter(([key]) => sourceFields.has(key))),
      );
    return value;
  });
  const assets = rawNodes.filter((node) => node.type === "image").map((node) => resolveImage(node, assetMap));
  const body = {
    schemaVersion: 1 as const,
    source: {
      schemaVersion: String(raw.schema_version ?? "unknown"),
      generated: String(raw.generated ?? "unknown"),
      sha256: hash(input),
    },
    scope: portable(object(raw.scope) ? raw.scope : {}) as KnowledgeSnapshot["scope"],
    evidenceClasses: Object.fromEntries(
      classes.map((key) => [
        key,
        object(raw.evidence_classes) && typeof raw.evidence_classes[key] === "string"
          ? raw.evidence_classes[key]
          : "Unspecified in source",
      ]),
    ) as Record<EvidenceClass, string>,
    nodes,
    relations,
    assets,
    issues: assets
      .filter((asset) => asset.status === "unavailable")
      .map((asset) => ({
        code: `ASSET_${asset.reason?.toUpperCase()}`,
        id: asset.id,
        message: "Image reference unavailable; no observation inferred",
      })),
    report: {
      nodeCount: nodes.length,
      relationCount: relations.length,
      imageCount: assets.length,
      resolvedImages: assets.filter((asset) => asset.status === "referenced").length,
      unavailableImages: assets.filter((asset) => asset.status === "unavailable").length,
    },
  };
  return ok({ ...body, hash: hash(body) });
}
