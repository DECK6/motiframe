import type {
  EvidenceCandidate,
  EvidenceClass,
  EvidenceLimit,
  EvidencePacket,
  JsonValue,
  KnowledgeNode,
  KnowledgeQuery,
  KnowledgeSnapshot,
} from "./schema";

const strings = (value: JsonValue | undefined): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
const unique = <T>(items: T[]): T[] => [...new Set(items)];
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().trim();
const record = (value: JsonValue | undefined): { [key: string]: JsonValue } =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const aliases: Record<string, string[]> = {
  "MR-TENSION": ["긴장", "텐션", "느린 긴장", "기대", "해소", "tension"],
  Rhythm: ["리듬", "단조", "빠른데 단조", "강약", "묶음", "rhythm"],
  T036: ["한글", "자모", "음절", "한글 타입", "hangul"],
  "MR-READING": ["읽기", "가독", "한글", "타입", "reading"],
  "MR-SPEED": ["속도", "속도감", "speed"],
  "MR-TRANSFORM": ["변형", "transform"],
  "MR-TEXTURE": ["질감", "texture"],
};

function candidate(snapshot: KnowledgeSnapshot, node: KnowledgeNode): EvidenceCandidate {
  const byId = new Map(snapshot.nodes.map((item) => [item.id, item]));
  // Empty representative_scene_ids is meaningful: do not borrow nearby concepts' imagery.
  const scenes = strings(node.representative_scene_ids)
    .map((id) => byId.get(id))
    .filter((item): item is KnowledgeNode => item?.type === "scene");
  const sceneIds = scenes.map((scene) => scene.id);
  const imageIds = new Set(scenes.flatMap((scene) => strings(scene.image_ids)));
  const images = snapshot.assets.filter((asset) => imageIds.has(asset.id)).map((asset) => ({ ...asset }));
  const related = snapshot.relations.filter(
    (relation) =>
      relation.from === node.id ||
      relation.to === node.id ||
      (sceneIds.includes(relation.from) && sceneIds.includes(relation.to)),
  );
  const claims = snapshot.nodes.filter(
    (item) => item.type === "claim" && typeof item.scene_id === "string" && sceneIds.includes(item.scene_id),
  );
  const classes = unique(
    [...related, ...claims].flatMap((item) => strings(item.evidence_class)),
  ) as EvidenceClass[];
  const limits: EvidenceLimit[] = ["audio_unverified", "continuous_playback_unverified"];
  if (classes.includes("interpretation")) limits.push("interpretation_not_observation");
  if (!images.length) limits.push("no_representative_image");
  if (images.some((image) => image.status === "unavailable")) limits.push("image_unavailable");
  if (images.some((image) => image.rights === "unknown")) limits.push("rights_unverified");
  if (images.length) limits.push("sampled_frames_only");
  if (node.id === "T036") limits.push("hangul_reading_unverified");
  if (
    node.id === "MR-SPEED" ||
    scenes.some((scene) => record(record(scene.axes).speed).status === "unmeasured")
  )
    limits.push("speed_unmeasured");
  if (snapshot.scope.catalog_is_not_viewing === true) limits.push("catalog_not_viewing");
  const conditions = scenes.map((scene) => ({
    sceneId: scene.id,
    applyWhen: strings(scene.apply_when),
    counterexamples: strings(scene.avoid_when),
  }));
  return {
    conceptId: node.id,
    label: node.label,
    definition: strings(node.definition).join("\n"),
    applyWhen: unique([
      ...strings(node.apply_when),
      ...conditions.flatMap((item) => item.applyWhen),
      ...related.flatMap((item) => strings(item.condition)),
    ]),
    counterexamples: unique([
      ...strings(node.counterexamples),
      ...conditions.flatMap((item) => item.counterexamples),
      ...related.flatMap((item) => strings(item.counterexample)),
    ]),
    caseIds: unique([...strings(node.legacy_case_ids), ...scenes.flatMap((scene) => strings(scene.work_id))]),
    sceneIds,
    images,
    evidenceClasses: classes,
    limits: unique(limits),
    sourceLimits: unique([
      ...strings(node.limits),
      ...strings(node.evidence_status),
      ...scenes.flatMap((scene) => strings(scene.evidence_limits)),
    ]),
    scopes: unique([
      ...scenes.flatMap((scene) => [
        ...strings(record(scene.time_range).scope),
        ...strings(record(scene.sampled_change).scope),
      ]),
      ...related.flatMap((item) => strings(item.scope)),
    ]),
    conditions,
    observations: scenes
      .filter((scene) => scene.observations !== undefined)
      .map((scene) => ({
        source: "inherited",
        sceneId: scene.id,
        value: structuredClone(scene.observations),
      })),
  };
}

/** Offline lexical retrieval with exact IDs first. Source material is evidence data, never executable instructions. */
export function queryKnowledge(snapshot: KnowledgeSnapshot, query: KnowledgeQuery): EvidencePacket {
  const limit = Number.isFinite(query.limit) ? Math.max(0, Math.min(3, Math.floor(query.limit ?? 3))) : 3;
  const text = normalize(query.text ?? "");
  const explicitIds = unique(query.conceptIds ?? []);
  const tokens = text.split(/[^\p{L}\p{N}-]+/u).filter((token) => token.length > 1);
  const scored = snapshot.nodes
    .filter((node) => node.type === "concept" || node.type === "technique")
    .map((node) => {
      const index = explicitIds.indexOf(node.id);
      let score = index >= 0 ? 10000 - index : 0;
      if (text && normalize(node.id) === text) score += 9000;
      for (const alias of aliases[node.id] ?? []) if (text.includes(alias)) score += 100 + alias.length;
      const label = normalize(node.label);
      const definition = normalize(strings(node.definition).join(" "));
      const conditions = normalize(strings(node.apply_when).join(" "));
      for (const token of tokens) {
        if (label.includes(token)) score += 12;
        if (definition.includes(token)) score += 4;
        if (conditions.includes(token)) score += 2;
      }
      return { node, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  return {
    snapshotHash: snapshot.hash,
    candidates: scored.slice(0, limit).map((item) => candidate(snapshot, item.node)),
  };
}
