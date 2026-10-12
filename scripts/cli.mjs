import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = JSON.parse(await readFile(path.join(root, ".runtime/manifest.json"), "utf8"));
const outfile = path.join(root, "dist/runner/cli.mjs");
await build({
  entryPoints: [path.join(root, "apps/runner/src/cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
});
const child = spawn(
  path.join(root, runtime.node),
  [outfile, ...process.argv.slice(2).filter((a) => a !== "--")],
  { stdio: "inherit", env: { ...process.env, MOTIFRAME_ROOT: root } },
);
child.on("exit", (code) => process.exit(code ?? 1));
