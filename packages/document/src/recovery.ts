import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, rename } from "node:fs/promises";
import path from "node:path";
import { projectContentHash } from "./history";
import { saveProject } from "./persistence";
import { fail, ok, type Result } from "./result";
import { type ProjectDocument, parseProject } from "./schema";

export type RecoveryReport = {
  current: { revision: number; contentHash: string } | null;
  candidates: { file: string; revision: number; contentHash: string }[];
  requiresChoice: boolean;
};
const snapshotName = /^(0|[1-9]\d*)-([a-f0-9]{64})\.json$/;
const ioFailure = (error: unknown) =>
  fail("RECOVERY_IO", error instanceof Error ? error.message : String(error));
async function projectPath(file: string): Promise<Result<string>> {
  try {
    const resolved = path.resolve(file),
      directory = await realpath(path.dirname(resolved));
    const target = path.join(directory, path.basename(resolved));
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink())
        return fail("INVALID_RECOVERY_PATH", "Project target must be a regular file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return ok(target);
  } catch (error) {
    return ioFailure(error);
  }
}
async function snapshotDirectory(file: string): Promise<Result<string>> {
  try {
    const directory = `${file}.snapshots`,
      info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== directory)
      return fail("INVALID_RECOVERY_PATH", "Snapshot directory must stay inside the project directory");
    return ok(directory);
  } catch (error) {
    return ioFailure(error);
  }
}
async function readRegular(file: string): Promise<Result<Buffer>> {
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await handle.stat()).isFile())
        return fail("INVALID_RECOVERY_PATH", "Recovery input must be a regular file");
      return ok(await handle.readFile());
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (["ELOOP", "EMLINK"].includes((error as NodeJS.ErrnoException).code ?? ""))
      return fail("INVALID_RECOVERY_PATH", "Recovery inputs cannot be symlinks");
    return ioFailure(error);
  }
}
function decode(bytes: Buffer): Result<ProjectDocument> {
  try {
    return parseProject(JSON.parse(bytes.toString("utf8")));
  } catch {
    return fail("INVALID_PROJECT", "Recovery document is malformed");
  }
}
async function readSnapshot(file: string, name: string): Promise<Result<ProjectDocument>> {
  const match = snapshotName.exec(name);
  if (!match || !Number.isSafeInteger(Number(match[1])))
    return fail("INVALID_RECOVERY_PATH", "Select a known recovery snapshot");
  const directory = await snapshotDirectory(file);
  if (!directory.ok) return directory;
  const bytes = await readRegular(path.join(directory.value, name));
  if (!bytes.ok) return bytes;
  if (createHash("sha256").update(bytes.value).digest("hex") !== match[2])
    return fail("SNAPSHOT_MISMATCH", "Snapshot bytes do not match its filename hash");
  const document = decode(bytes.value);
  if (!document.ok) return document;
  if (document.value.revision !== Number(match[1]))
    return fail("SNAPSHOT_MISMATCH", "Snapshot revision does not match its filename");
  return document;
}
export async function recoverProject(file: string): Promise<Result<RecoveryReport>> {
  const target = await projectPath(file);
  if (!target.ok) return target;
  const bytes = await readRegular(target.value),
    current = bytes.ok ? decode(bytes.value) : bytes;
  const candidates: RecoveryReport["candidates"] = [];
  const directory = await snapshotDirectory(target.value);
  if (directory.ok) {
    try {
      for (const name of await readdir(directory.value)) {
        if (!snapshotName.test(name)) continue;
        const candidate = await readSnapshot(target.value, name);
        if (candidate.ok)
          candidates.push({
            file: name,
            revision: candidate.value.revision,
            contentHash: projectContentHash(candidate.value),
          });
      }
    } catch (error) {
      return ioFailure(error);
    }
  }
  candidates.sort((a, b) => b.revision - a.revision || a.file.localeCompare(b.file));
  return ok({
    current: current.ok
      ? { revision: current.value.revision, contentHash: projectContentHash(current.value) }
      : null,
    candidates,
    requiresChoice: !current.ok,
  });
}
/** Caller holds the project writer lease. Recovery is always an explicit user choice. */
export async function restoreSnapshot(file: string, name: string): Promise<Result<ProjectDocument>> {
  const target = await projectPath(file);
  if (!target.ok) return target;
  const candidate = await readSnapshot(target.value, name);
  if (!candidate.ok) return candidate;
  let preserved: string | undefined;
  try {
    try {
      const current = await lstat(target.value);
      if (!current.isFile() || current.isSymbolicLink())
        return fail("INVALID_RECOVERY_PATH", "Project target must be a regular file");
      preserved = `${target.value}.preserved-${randomUUID()}`;
      await rename(target.value, preserved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const saved = await saveProject(candidate.value, target.value);
    if (saved.ok) return ok(candidate.value);
    // Keep the original available at its familiar location if publishing the chosen snapshot fails.
    if (preserved) {
      try {
        await lstat(target.value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") await rename(preserved, target.value);
      }
    }
    return saved;
  } catch (error) {
    return ioFailure(error);
  }
}
