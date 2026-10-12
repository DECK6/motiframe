import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { captureProject } from "../apps/runner/src/capture";
import { runtime } from "../apps/runner/src/environment";
import { renderProject } from "../apps/runner/src/render-job";
import { hashFile } from "../packages/media/src/assets";
import { probeAsset } from "../packages/media/src/probe";
import { createMixedFixture } from "./create-fixtures";
export type SmokeReport = {
  schemaVersion: 1;
  ok: boolean;
  platform: string;
  arch: string;
  osRelease: string;
  orchestrator: string;
  runtimeHashes: Record<string, string>;
  commandExits: { command: string; exitCode: number; version?: string }[];
  checks: { name: string; ok: boolean; detail?: string }[];
  artifacts: { path: string; sha256: string }[];
  reportPath: string;
};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function executable(name: string): Promise<string> {
  for (const folder of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!folder) continue;
    const candidate = path.join(folder, `${name}${process.platform === "win32" ? ".exe" : ""}`);
    if (
      await access(candidate, constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return realpath(candidate);
  }
  throw new Error(`Required executable is absent from PATH: ${name}`);
}
export async function runCoreSmoke(options: { outputDir?: string } = {}): Promise<SmokeReport> {
  const root = process.cwd(),
    folder = path.resolve(
      options.outputDir ??
        path.join("artifacts/core-smoke", `${process.platform}-${process.arch}-${Date.now()}`),
    );
  await mkdir(folder, { recursive: true });
  const report: SmokeReport = {
    schemaVersion: 1,
    ok: false,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    orchestrator: `node ${process.version}`,
    runtimeHashes: {},
    commandExits: [],
    checks: [],
    artifacts: [],
    reportPath: path.relative(root, path.join(folder, "report.json")),
  };
  const command = (name: string, args: string[], label = name) => {
    const result = spawnSync(name, args, { encoding: null, maxBuffer: 16 * 1024 ** 2 });
    report.commandExits.push({
      command: label,
      exitCode: result.status ?? 1,
      ...(args.includes("-version") || args.includes("--version")
        ? { version: result.stdout?.toString().split("\n")[0] }
        : {}),
    });
    if (result.error || result.status !== 0) throw new Error(`${label} exited ${result.status ?? 1}`);
    return result.stdout;
  };
  try {
    const locked = JSON.parse(await readFile("runtime-lock.json", "utf8")),
      resolved = await runtime();
    report.runtimeHashes = {
      node: await hashFile(resolved.node),
      chrome: await hashFile(resolved.chrome),
      ffmpeg: await hashFile(await executable("ffmpeg")),
      ffprobe: await hashFile(await executable("ffprobe")),
    };
    report.checks.push({
      name: "pinned runtime hashes",
      ok:
        report.runtimeHashes.node === resolved.hashes.node &&
        report.runtimeHashes.chrome === resolved.hashes.chrome,
    });
    const nodeVersion = command(resolved.node, ["--version"], "pinned node --version").toString().trim();
    const ffmpegVersion = command("ffmpeg", ["-version"]).toString().split("\n")[0],
      ffprobeVersion = command("ffprobe", ["-version"]).toString().split("\n")[0];
    report.checks.push({
      name: "pinned Node and FFmpeg versions",
      ok:
        nodeVersion === `v${locked.node}` &&
        ffmpegVersion.includes(`version ${locked.ffmpeg}`) &&
        ffprobeVersion.includes(`version ${locked.ffmpeg}`),
    });
    const fixture = await createMixedFixture(),
      metadata = await probeAsset(path.join(fixture.folder, "assets/video.mp4"));
    if (!metadata.ok) throw new Error(metadata.error.code);
    report.checks.push({
      name: "synthetic source CFR metadata",
      ok:
        metadata.value.width === 320 &&
        metadata.value.height === 180 &&
        !metadata.value.vfr &&
        metadata.value.framePts.length === 90,
    });
    for (const tick of [0, 360000, 800000]) {
      const capture = await captureProject(fixture.project, { tick, projectDir: fixture.folder });
      if (!capture.ok) throw new Error(capture.error.code);
      const output = path.join(folder, `frame-${tick}.png`);
      await writeFile(output, capture.value.png);
      report.artifacts.push({ path: path.relative(root, output), sha256: sha(capture.value.png) });
      report.checks.push({
        name: `mixed frame receipt ${tick}`,
        ok:
          capture.value.receipt.ready &&
          capture.value.receipt.tick === tick &&
          capture.value.inspection.sameDocument &&
          capture.value.inspection.kinds.includes("react") &&
          capture.value.inspection.kinds.includes("html"),
      });
    }
    const outputPath = path.join(folder, "mixed.mp4"),
      rendered = await renderProject(fixture.project, { projectDir: fixture.folder, outputPath });
    if (!rendered.ok) throw new Error(rendered.error.code);
    const streams = JSON.parse(
      command(
        "ffprobe",
        ["-v", "error", "-count_frames", "-show_streams", "-of", "json", outputPath],
        "ffprobe exported MP4",
      ).toString(),
    ).streams as { codec_type: string; nb_read_frames: string; r_frame_rate: string }[];
    const video = streams.find((stream) => stream.codec_type === "video");
    report.checks.push({
      name: "180 output frames at 30 fps",
      ok: rendered.value.frames === 180 && video?.nb_read_frames === "180" && video.r_frame_rate === "30/1",
    });
    const pcm = command(
      "ffmpeg",
      ["-v", "error", "-i", rendered.value.audioPath, "-f", "f32le", "-ac", "1", "pipe:1"],
      "decode mixed WAV",
    );
    let pulse = -1;
    for (let i = 0; i < pcm.length / 4; i++)
      if (Math.abs(pcm.readFloatLE(i * 4)) > 0.1) {
        pulse = i;
        break;
      }
    report.checks.push({
      name: "48 kHz pulse sample 72000",
      ok: pulse === 72000,
      detail: `observed sample ${pulse}`,
    });
    command(
      "ffmpeg",
      ["-v", "error", "-i", outputPath, "-f", "null", "-"],
      "decode exported audio and video",
    );
    report.artifacts.push({ path: path.relative(root, outputPath), sha256: await hashFile(outputPath) });
  } catch (error) {
    report.checks.push({
      name: "smoke execution",
      ok: false,
      detail: String(error).replaceAll(root, "<project>").replaceAll(os.homedir(), "<home>"),
    });
  }
  report.ok =
    report.checks.length > 0 &&
    report.checks.every((check) => check.ok) &&
    report.commandExits.every((command) => command.exitCode === 0);
  await writeFile(path.join(folder, "report.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const native = await runtime();
  if (process.execPath !== native.node && !process.env.MOTIFRAME_SMOKE_CHILD) {
    const child = spawnSync(native.node, ["--import", "tsx", fileURLToPath(import.meta.url)], {
      stdio: "inherit",
      env: { ...process.env, MOTIFRAME_SMOKE_CHILD: "1" },
    });
    process.exitCode = child.status ?? 1;
  } else {
    const report = await runCoreSmoke();
    console.log(
      JSON.stringify({
        ok: report.ok,
        platform: report.platform,
        arch: report.arch,
        checks: report.checks,
        report: report.reportPath,
      }),
    );
    process.exitCode = report.ok ? 0 : 1;
  }
}
