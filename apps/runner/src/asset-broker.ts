import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import type { ProjectDocument } from "../../../packages/document/src/schema";
import type { StageAssets } from "../../../packages/stage/src/main";
export type AssetFile = { id: string; path: string; hash: string; kind: string; family?: string };
export async function resolveAssets(
  document: ProjectDocument,
  projectDir: string,
): Promise<Result<{ files: Record<string, AssetFile>; stage: StageAssets; hash: string }>> {
  try {
    const root = await realpath(projectDir);
    const files: Record<string, AssetFile> = {};
    const stage: StageAssets = { fonts: [] };
    for (const [id, value] of Object.entries(document.assets)) {
      const a = value as {
        logicalPath?: string;
        sha256?: string;
        kind?: string;
        fontMetadata?: { family?: string };
      };
      if (!a.logicalPath || path.isAbsolute(a.logicalPath))
        return fail("ASSET_PATH_DENIED", "Assets must use project-relative paths", [id]);
      const file = await realpath(path.resolve(root, a.logicalPath));
      const relative = path.relative(root, file);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        return fail("ASSET_PATH_DENIED", "Asset escapes project root", [id]);
      const bytes = await readFile(file);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (a.sha256 && a.sha256 !== hash)
        return fail("ASSET_HASH_MISMATCH", "Asset contents changed; relink explicitly", [id]);
      files[id] = { id, path: file, hash, kind: a.kind ?? "unknown", family: a.fontMetadata?.family };
      if (a.kind === "font") {
        if (!a.fontMetadata?.family)
          return fail("FONT_FAMILY_REQUIRED", "Fonts need a declared family", [id]);
        stage.fonts.push({
          family: a.fontMetadata.family,
          url: `data:font/ttf;base64,${bytes.toString("base64")}`,
        });
      }
    }
    return ok({
      files,
      stage,
      hash: createHash("sha256")
        .update(
          Object.entries(files)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, a]) => `${id}:${a.hash}`)
            .join("\n"),
        )
        .digest("hex"),
    });
  } catch (error) {
    return fail("ASSET_UNAVAILABLE", String(error));
  }
}
