import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, install } from "@puppeteer/browsers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(path.join(root, "runtime-lock.json"), "utf8"));
const runtime = path.join(root, ".runtime");
await mkdir(runtime, { recursive: true });
const platform = process.platform === "win32" ? "win" : process.platform;
const archive = `node-v${lock.node}-${platform}-${process.arch}.${platform === "win" ? "zip" : "tar.gz"}`;
const directory = `node-v${lock.node}-${platform}-${process.arch}`;
const nodePath = path.join(runtime, directory, platform === "win" ? "node.exe" : "bin/node");
if (!existsSync(nodePath)) {
  const base = `https://nodejs.org/dist/v${lock.node}/`;
  const sums = await (await fetch(`${base}SHASUMS256.txt`)).text();
  const expected = sums
    .split("\n")
    .find((line) => line.endsWith(`  ${archive}`))
    ?.split(" ")[0];
  if (!expected) throw new Error("Unsupported Node runtime platform");
  const response = await fetch(base + archive);
  if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new Error("Node archive hash mismatch");
  const target = path.join(runtime, archive);
  await writeFile(target, bytes);
  if (platform === "win") execFileSync("tar", ["-xf", target, "-C", runtime]);
  else execFileSync("tar", ["-xzf", target, "-C", runtime]);
}
const chrome = await install({
  browser: Browser.CHROMEHEADLESSSHELL,
  buildId: lock.chrome,
  cacheDir: path.join(runtime, "browsers"),
});
const hashFile = async (p) =>
  createHash("sha256")
    .update(await readFile(p))
    .digest("hex");
const manifest = {
  node: path.relative(root, nodePath),
  chrome: path.relative(root, chrome.executablePath),
  nodeSha256: await hashFile(nodePath),
  chromeSha256: await hashFile(chrome.executablePath),
  platform: process.platform,
  arch: process.arch,
};
await writeFile(path.join(runtime, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    ok: true,
    node: execFileSync(nodePath, ["--version"], { encoding: "utf8" }).trim(),
    chrome: lock.chrome,
    platform: manifest.platform,
    arch: manifest.arch,
  }),
);
