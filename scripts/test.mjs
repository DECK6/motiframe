import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(root, ".runtime/manifest.json"), "utf8"));
const filters = process.argv.slice(2).filter((x) => x !== "--");
if (filters.length > 1 && /^tests\/(unit|integration|e2e)$/.test(filters[0])) filters.shift();
const result = spawnSync(
  path.join(root, manifest.node),
  [path.join(root, "node_modules/vitest/vitest.mjs"), "run", ...filters],
  { cwd: root, stdio: "inherit" },
);
process.exit(result.status ?? 1);
