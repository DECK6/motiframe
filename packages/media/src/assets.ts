import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fail, ok, type Result } from "../../document/src/result";
import { mediaFailure } from "./process";

export async function hashFile(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest("hex");
}
export async function resolveAssetFile(
  asset: unknown,
  projectDir: string,
  signal?: AbortSignal,
): Promise<Result<string>> {
  if (signal?.aborted) return fail("CANCELLED", "Media operation was cancelled");
  if (!asset || typeof asset !== "object") return fail("INVALID_ASSET", "Missing media asset");
  const { logicalPath, sha256 } = asset as { logicalPath?: unknown; sha256?: unknown };
  if (
    typeof logicalPath !== "string" ||
    !logicalPath ||
    logicalPath.includes("\\") ||
    logicalPath.includes("\0") ||
    path.isAbsolute(logicalPath) ||
    /^[a-zA-Z]:/.test(logicalPath) ||
    logicalPath.split("/").some((p) => p === ".." || p === "." || !p)
  )
    return fail("INVALID_ASSET_PATH", "Assets require a portable relative file path");
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sha256))
    return fail("INVALID_ASSET", "Asset requires a SHA-256 hash");
  try {
    const root = await realpath(projectDir);
    let current = root;
    for (const segment of logicalPath.split("/")) {
      current = path.join(current, segment);
      if ((await lstat(current)).isSymbolicLink())
        return fail("INVALID_ASSET_PATH", "Symlinked assets are not allowed");
    }
    if (!(await lstat(current)).isFile()) return fail("INVALID_ASSET_PATH", "Asset must be a regular file");
    if ((await hashFile(current, signal)) !== sha256.toLowerCase())
      return fail("ASSET_HASH_MISMATCH", "Asset differs from the document hash");
    return ok(current);
  } catch (error) {
    return signal?.aborted ? fail("CANCELLED", "Media operation was cancelled") : mediaFailure(error);
  }
}
