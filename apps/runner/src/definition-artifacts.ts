import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import type { ProjectDocument } from "../../../packages/document/src/schema";
export async function loadDefinitionArtifacts(
  document: ProjectDocument,
  projectDir: string,
): Promise<Result<string[]>> {
  try {
    const root = await realpath(projectDir),
      codes: string[] = [];
    for (const manifest of Object.values(document.definitions)) {
      if (manifest.moduleHash.startsWith("builtin:")) continue;
      if (!/^[a-f0-9]{64}$/.test(manifest.moduleHash))
        return fail("INVALID_MODULE_HASH", "Custom definitions require a SHA-256 artifact", [manifest.id]);
      const p = await realpath(path.join(root, "definitions", `${manifest.moduleHash}.js`));
      if (path.relative(root, p).startsWith(".."))
        return fail("CAPABILITY_DENIED", "Definition escapes project root", [manifest.id]);
      const code = await readFile(p, "utf8");
      if (createHash("sha256").update(code).digest("hex") !== manifest.moduleHash)
        return fail("MODULE_HASH_MISMATCH", "Definition artifact changed", [manifest.id]);
      codes.push(code);
    }
    return ok(codes);
  } catch (error) {
    return fail("DEFINITION_UNAVAILABLE", String(error));
  }
}
