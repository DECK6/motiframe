import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { fail, ok, type Result } from "../../../packages/document/src/result";
/** Immutable project artifacts; rejects symlink parents and never truncates existing files. */
export async function writeProjectArtifact(
  projectDir: string,
  logicalPath: string,
  bytes: Uint8Array,
): Promise<Result<{ path: string }>> {
  if (!/^(?:assets|definitions)\/[A-Za-z0-9_.-]+$/.test(logicalPath))
    return fail("UNSAFE_ARTIFACT_PATH", "Artifact path must be a direct project assets or definitions file");
  try {
    const root = await realpath(projectDir),
      folder = path.join(root, logicalPath.split("/")[0]);
    await mkdir(folder, { recursive: true });
    if ((await lstat(folder)).isSymbolicLink() || (await realpath(folder)) !== folder)
      return fail("UNSAFE_ARTIFACT_PATH", "Artifact directory cannot redirect outside the project");
    const file = path.join(root, logicalPath);
    try {
      const h = await open(
        file,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      try {
        await h.writeFile(bytes);
        await h.sync();
      } finally {
        await h.close();
      }
      return ok({ path: file });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await lstat(file);
      if (stat.isSymbolicLink() || !stat.isFile())
        return fail("UNSAFE_ARTIFACT_PATH", "Artifact must be a regular file");
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const previous = await handle.readFile();
        return previous.equals(Buffer.from(bytes))
          ? ok({ path: file })
          : fail("ARTIFACT_CONFLICT", "An immutable artifact already has different bytes");
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    return fail("ARTIFACT_WRITE_FAILED", String(error));
  }
}
