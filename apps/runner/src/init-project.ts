import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { saveProject } from "../../../packages/document/src/persistence";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import { createStarterProject } from "../../../packages/document/src/starter";
import { projectRoot } from "./environment";
export async function initProject(folder: string): Promise<Result<{ file: string }>> {
  try {
    const file = path.join(path.resolve(folder), "project.json");
    if (
      await stat(file)
        .then(() => true)
        .catch(() => false)
    )
      return fail("PROJECT_EXISTS", "Project already exists; open it instead");
    await mkdir(path.join(folder, "assets"), { recursive: true });
    const doc = createStarterProject(path.basename(folder));
    const font = path.join(projectRoot, "assets/fonts/NotoSansKR.ttf");
    await copyFile(font, path.join(folder, "assets/NotoSansKR.ttf"));
    await copyFile(path.join(projectRoot, "assets/fonts/OFL.txt"), path.join(folder, "assets/OFL.txt"));
    doc.assets.font = {
      kind: "font",
      logicalPath: "assets/NotoSansKR.ttf",
      sha256: createHash("sha256")
        .update(await readFile(font))
        .digest("hex"),
      fontMetadata: { family: "MotiFrame Sans" },
    };
    const saved = await saveProject(doc, file);
    return saved.ok ? ok({ file }) : saved;
  } catch (error) {
    return fail("INIT_FAILED", String(error));
  }
}
