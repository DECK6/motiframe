export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type EvidenceClass = "observation" | "measurement" | "creator_statement" | "interpretation";
export type KnowledgeNode = { id: string; type: string; label: string; [key: string]: JsonValue };
export type KnowledgeRelation = {
  id: string;
  from: string;
  to: string;
  type: string;
  [key: string]: JsonValue;
};
export type KnowledgeAsset = {
  id: string;
  sceneId?: string;
  legacyPath?: string;
  assetId: string;
  expectedSha256?: string;
  sha256?: string;
  status: "referenced" | "unavailable";
  rights: "unknown" | "reference-only" | "cleared";
  observation: "unverified";
  reason?: "missing" | "hash_mismatch" | "hash_missing" | "outside_root" | "invalid_path";
};
export type AssetMap = {
  roots?: { legacyPrefix: string; root: string }[];
  images?: Record<string, { path: string; sha256?: string; rights?: KnowledgeAsset["rights"] }>;
};
export type KnowledgeIssue = { code: string; id: string; message: string };
export type KnowledgeSnapshot = {
  schemaVersion: 1;
  hash: string;
  source: { schemaVersion: string; generated: string; sha256: string };
  scope: { [key: string]: JsonValue };
  evidenceClasses: Record<EvidenceClass, string>;
  nodes: KnowledgeNode[];
  relations: KnowledgeRelation[];
  assets: KnowledgeAsset[];
  issues: KnowledgeIssue[];
  report: {
    nodeCount: number;
    relationCount: number;
    imageCount: number;
    resolvedImages: number;
    unavailableImages: number;
  };
};
export type EvidenceLimit =
  | "audio_unverified"
  | "continuous_playback_unverified"
  | "sampled_frames_only"
  | "speed_unmeasured"
  | "interpretation_not_observation"
  | "no_representative_image"
  | "image_unavailable"
  | "rights_unverified"
  | "hangul_reading_unverified"
  | "catalog_not_viewing";
export type KnowledgeQuery = { conceptIds?: string[]; text?: string; limit?: number };
export type EvidenceCandidate = {
  conceptId: string;
  label: string;
  definition: string;
  applyWhen: string[];
  counterexamples: string[];
  caseIds: string[];
  sceneIds: string[];
  images: KnowledgeAsset[];
  evidenceClasses: EvidenceClass[];
  limits: EvidenceLimit[];
  sourceLimits: string[];
  scopes: string[];
  conditions: { sceneId: string; applyWhen: string[]; counterexamples: string[] }[];
  observations: { source: "inherited"; sceneId: string; value: JsonValue }[];
};
export type EvidencePacket = { snapshotHash: string; candidates: EvidenceCandidate[] };
