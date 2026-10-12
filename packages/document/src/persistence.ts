import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fail, ok, type Result } from "./result";
import { type ProjectDocument, parseProject } from "./schema";

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    // Windows does not consistently expose directory handles/flushes through Node.
    // The temporary file itself is always flushed before the atomic rename.
    if (
      process.platform === "win32" &&
      ["EPERM", "EISDIR", "EINVAL", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")
    )
      return;
    throw error;
  }
}

/** The caller owns the single-writer lock. An interrupted temporary write leaves the old file intact. */
export async function saveProject(document: ProjectDocument, file: string): Promise<Result<void>> {
  const parsed = parseProject(document);
  if (!parsed.ok) return parsed;
  const target = resolve(file),
    directory = dirname(target);
  try {
    await mkdir(directory, { recursive: true });
    const bytes = Buffer.from(`${JSON.stringify(parsed.value, null, 2)}\n`);
    const temporary = `${directory}/.${basename(target)}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const written = await readFile(temporary);
    if (!written.equals(bytes) || !parseProject(JSON.parse(written.toString("utf8"))).ok)
      return fail("SAVE_VERIFICATION_FAILED", "Temporary project verification failed");
    let previous: Buffer | undefined;
    try {
      if ((await lstat(target)).isSymbolicLink())
        return fail("INVALID_PROJECT_PATH", "Project target cannot be a symlink");
      previous = await readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      // Preserve only valid previous documents; a corrupt original is never overwritten by this path.
      const old = parseProject(JSON.parse(previous.toString("utf8")));
      if (!old.ok) return fail("INVALID_PREVIOUS_PROJECT", "Current project must be recovered before saving");
      const snapshots = `${target}.snapshots`;
      await mkdir(snapshots, { recursive: true });
      if ((await lstat(snapshots)).isSymbolicLink())
        return fail("INVALID_PROJECT_PATH", "Snapshot directory cannot be a symlink");
      const digest = createHash("sha256").update(previous).digest("hex");
      const snapshot = `${snapshots}/${old.value.revision}-${digest}.json`;
      try {
        await link(target, snapshot);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          !(await readFile(snapshot)).equals(previous)
        )
          throw error;
      }
      await syncDirectory(snapshots);
    }
    await rename(temporary, target);
    await syncDirectory(directory);
    return ok(undefined);
  } catch (error) {
    return fail("PROJECT_IO", error instanceof Error ? error.message : "Project save failed");
  }
}

export async function loadProject(file: string): Promise<Result<ProjectDocument>> {
  try {
    return parseProject(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    return fail("PROJECT_IO", error instanceof Error ? error.message : "Project load failed");
  }
}
