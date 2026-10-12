import { readFile } from "node:fs/promises";
import path from "node:path";
export const projectRoot = process.env.MOTIFRAME_ROOT ?? process.cwd();
export async function runtime() {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, ".runtime/manifest.json"), "utf8"));
  return {
    node: path.resolve(projectRoot, manifest.node),
    chrome: path.resolve(projectRoot, manifest.chrome),
    hashes: { node: manifest.nodeSha256, chrome: manifest.chromeSha256 },
  };
}
