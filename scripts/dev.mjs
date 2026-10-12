import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const file = path.resolve("examples/quickstart/project.json");
if (!existsSync("dist/runner/cli.mjs")) {
  const built = spawnSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
  if (built.status) process.exit(built.status);
}
if (!existsSync(file)) {
  const init = spawnSync(process.execPath, ["scripts/cli.mjs", "init", path.dirname(file)], {
    stdio: "inherit",
  });
  if (init.status) process.exit(init.status);
}
const child = spawn(process.execPath, ["scripts/cli.mjs", "studio", file, "--dev", "--port", "4173"], {
  stdio: "inherit",
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
