import { lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { importOntology } from "../packages/knowledge/src/import";
import type { AssetMap } from "../packages/knowledge/src/schema";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const input = flag("--input");
const output = flag("--output");
if (!input || !output) {
  process.stderr.write(
    "Usage: bun scripts/import-motion-knowledge.ts --input source.json --output snapshot.json [--asset-root directory | --asset-map mapping.json]\n",
  );
  process.exit(2);
}
try {
  const root = flag("--asset-root");
  const mapFile = flag("--asset-map");
  const map: AssetMap = mapFile
    ? JSON.parse(readFileSync(mapFile, "utf8"))
    : { roots: root ? [{ legacyPrefix: "", root }] : [] };
  const result = importOntology(readFileSync(input, "utf8"), map);
  if (!result.ok) {
    process.stderr.write(`${JSON.stringify(result.error)}\n`);
    process.exit(2);
  }
  if (resolve(input) === resolve(output)) throw new Error("Output must differ from the source ontology");
  try {
    const sourceStat = statSync(input),
      targetStat = lstatSync(output);
    if (
      targetStat.isSymbolicLink() ||
      (sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino)
    )
      throw new Error("Output cannot alias the source ontology or follow a symlink");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result.value, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ hash: result.value.hash, source: result.value.source, ...result.value.report })}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Import failed"}\n`);
  process.exit(4);
}
