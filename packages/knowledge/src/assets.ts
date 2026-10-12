import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { AssetMap, KnowledgeAsset, KnowledgeNode } from "./schema";

const digest = /^[a-f0-9]{64}$/i;
const contained = (root: string, file: string) => {
  const rel = relative(root, file);
  return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
};

/** Reads only image nodes admitted by an explicit ID mapping or a contained root mapping. */
export function resolveImage(node: KnowledgeNode, map: AssetMap): KnowledgeAsset {
  const legacyPath =
    typeof node.path === "string" && !isAbsolute(node.path) && !node.path.split(/[\\/]/).includes("..")
      ? node.path
      : undefined;
  const expected =
    typeof node.sha256 === "string" && digest.test(node.sha256) ? node.sha256.toLowerCase() : undefined;
  const explicit = map.images?.[node.id];
  const asset: KnowledgeAsset = {
    id: node.id,
    sceneId: typeof node.scene_id === "string" ? node.scene_id : undefined,
    legacyPath,
    assetId: `knowledge-image:${encodeURIComponent(node.id)}`,
    expectedSha256: expected,
    status: "unavailable",
    rights: explicit?.rights ?? "unknown",
    observation: "unverified",
  };
  if (!expected) return { ...asset, reason: "hash_missing" };
  if (explicit?.sha256 && explicit.sha256.toLowerCase() !== expected)
    return { ...asset, reason: "hash_mismatch" };
  let file = explicit?.path;
  let root: string | undefined;
  if (!file && legacyPath) {
    const mapping = map.roots?.find((item) => legacyPath.startsWith(item.legacyPrefix));
    if (mapping) {
      root = resolve(mapping.root);
      file = resolve(root, legacyPath.slice(mapping.legacyPrefix.length));
      if (!contained(root, file)) return { ...asset, reason: "outside_root" };
    }
  }
  if (!file) return { ...asset, reason: legacyPath ? "missing" : "invalid_path" };
  try {
    const actualPath = realpathSync(file);
    if (root && !contained(realpathSync(root), actualPath)) return { ...asset, reason: "outside_root" };
    if (!statSync(actualPath).isFile()) return { ...asset, reason: "missing" };
    const actualHash = createHash("sha256").update(readFileSync(actualPath)).digest("hex");
    if (actualHash !== expected) return { ...asset, reason: "hash_mismatch" };
    return { ...asset, sha256: actualHash, status: "referenced" };
  } catch {
    return { ...asset, reason: "missing" };
  }
}
