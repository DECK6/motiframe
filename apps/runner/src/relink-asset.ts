import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import type { JsonValue, ProjectDocument } from "../../../packages/document/src/schema";
import { hashFile } from "../../../packages/media/src/assets";

export type AssetFileStatus = {
  status: "available" | "missing" | "hash-mismatch" | "unsafe" | "invalid";
  missing: boolean;
  logicalPath?: string;
  code?: string;
};
type Metadata = { logicalPath: string; sha256: string };
function metadata(value: unknown): Result<Metadata> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("INVALID_ASSET", "Asset metadata is missing");
  const { logicalPath, sha256 } = value as { logicalPath?: unknown; sha256?: unknown };
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(sha256))
    return fail("INVALID_ASSET", "Asset requires its original SHA-256 hash");
  if (
    typeof logicalPath !== "string" ||
    !logicalPath.startsWith("assets/") ||
    /[\\:\x00-\x1f\x7f]/.test(logicalPath) ||
    logicalPath.split("/").some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part))
  )
    return fail("ASSET_PATH_DENIED", "Relinking requires a portable path inside the project's assets folder");
  return ok({ logicalPath, sha256: sha256.toLowerCase() });
}
async function location(
  root: string,
  logicalPath: string,
): Promise<Result<{ file: string; exists: boolean }>> {
  const parts = logicalPath.split("/"),
    file = path.join(root, ...parts);
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) return ok({ file, exists: false });
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
      return fail("ASSET_PATH_DENIED", "Asset paths cannot contain symlinks or non-regular files");
  }
  return ok({ file, exists: true });
}
export async function inspectAssetFiles(
  document: ProjectDocument,
  options: { projectDir: string; signal?: AbortSignal },
): Promise<Result<Record<string, AssetFileStatus>>> {
  if (options.signal?.aborted) return fail("CANCELLED", "Asset inspection was cancelled");
  try {
    const root = await realpath(options.projectDir),
      entries: [string, AssetFileStatus][] = [];
    for (const [id, asset] of Object.entries(document.assets)) {
      options.signal?.throwIfAborted();
      const parsed = metadata(asset);
      if (!parsed.ok) {
        entries.push([
          id,
          {
            status: parsed.error.code === "ASSET_PATH_DENIED" ? "unsafe" : "invalid",
            missing: true,
            code: parsed.error.code,
          },
        ]);
        continue;
      }
      const resolved = await location(root, parsed.value.logicalPath);
      let status: AssetFileStatus;
      if (!resolved.ok) status = { status: "unsafe", missing: true, code: resolved.error.code };
      else if (!resolved.value.exists)
        status = { status: "missing", missing: true, code: "ASSET_UNAVAILABLE" };
      else if ((await hashFile(resolved.value.file, options.signal)) !== parsed.value.sha256)
        status = { status: "hash-mismatch", missing: true, code: "ASSET_HASH_MISMATCH" };
      else status = { status: "available", missing: false };
      entries.push([id, { ...status, logicalPath: parsed.value.logicalPath }]);
    }
    return ok(Object.fromEntries(entries));
  } catch {
    return options.signal?.aborted
      ? fail("CANCELLED", "Asset inspection was cancelled")
      : fail("ASSET_IO", "Could not inspect project assets");
  }
}
export async function relinkAsset(
  document: ProjectDocument,
  assetId: string,
  options: { projectDir: string; bytes: Uint8Array; signal?: AbortSignal },
): Promise<Result<{ assetId: string; asset: JsonValue; logicalPath: string; restored: boolean }>> {
  if (options.signal?.aborted) return fail("CANCELLED", "Asset relinking was cancelled");
  if (!Object.hasOwn(document.assets, assetId))
    return fail("UNKNOWN_ASSET", "The original asset ID is not registered", [assetId]);
  const asset = document.assets[assetId],
    parsed = metadata(asset);
  if (!parsed.ok) return parsed;
  if (options.bytes.byteLength > 180 * 1024 ** 2)
    return fail("ASSET_TOO_LARGE", "Relink uploads are limited to 180 MiB", [assetId]);
  const bytes = Buffer.from(options.bytes),
    hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== parsed.value.sha256)
    return fail(
      "ASSET_HASH_MISMATCH",
      "Choose the original file; replacement bytes must match the registered SHA-256 hash",
      [assetId],
    );
  try {
    const root = await realpath(options.projectDir),
      resolved = await location(root, parsed.value.logicalPath);
    if (!resolved.ok) return resolved;
    if (
      resolved.value.exists &&
      (await hashFile(resolved.value.file, options.signal)) === parsed.value.sha256
    )
      return ok({
        assetId,
        asset: structuredClone(asset),
        logicalPath: parsed.value.logicalPath,
        restored: false,
      });
    options.signal?.throwIfAborted();
    await mkdir(path.dirname(resolved.value.file), { recursive: true });
    const checked = await location(root, parsed.value.logicalPath);
    if (!checked.ok) return checked;
    const temporary = path.join(path.dirname(checked.value.file), `.relink-${randomUUID()}.pending`);
    await writeFile(temporary, bytes, { flag: "wx", signal: options.signal });
    options.signal?.throwIfAborted();
    let backup: string | undefined;
    if (checked.value.exists) {
      const backupFolder = path.join(root, "assets/relink-backups");
      await mkdir(backupFolder, { recursive: true });
      if ((await lstat(backupFolder)).isSymbolicLink())
        return fail("ASSET_PATH_DENIED", "Asset backup folder cannot be symlinked");
      backup = path.join(backupFolder, `${randomUUID()}-${path.basename(checked.value.file)}`);
      await rename(checked.value.file, backup);
    }
    try {
      await rename(temporary, checked.value.file);
    } catch (error) {
      if (
        backup &&
        !(await lstat(checked.value.file).then(
          () => true,
          () => false,
        ))
      )
        await rename(backup, checked.value.file);
      throw error;
    }
    return ok({
      assetId,
      asset: structuredClone(asset),
      logicalPath: parsed.value.logicalPath,
      restored: true,
    });
  } catch {
    return options.signal?.aborted
      ? fail("CANCELLED", "Asset relinking was cancelled")
      : fail("ASSET_IO", "Could not restore the asset; existing files were preserved", [assetId]);
  }
}
