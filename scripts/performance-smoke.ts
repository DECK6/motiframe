import { spawnSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runtime } from "../apps/runner/src/environment";
import { PreviewEngine } from "../apps/runner/src/preview";
import { benchmarkFrameWorkload } from "../packages/core/src/cache";
import type { ProjectDocument } from "../packages/document/src/schema";
import { hashFile } from "../packages/media/src/assets";
import { createMixedFixture } from "./create-fixtures";
export async function benchmarkPreview(options: { samples?: number; outputDir?: string } = {}) {
  const samples = options.samples ?? 60;
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 120)
    throw new RangeError("Preview benchmark samples must be between 1 and 120");
  const folder = path.resolve(
    options.outputDir ??
      path.join("artifacts/performance", `${process.platform}-${process.arch}-${Date.now()}`),
  );
  await mkdir(path.join(folder, "assets"), { recursive: true });
  const fixture = await createMixedFixture(),
    doc = structuredClone(fixture.project) as unknown as ProjectDocument;
  const duration = 30 * 240000;
  doc.id = "performance-30-layers-two-videos";
  doc.settings = { ...doc.settings, width: 1280, height: 720, duration };
  doc.instances = {};
  doc.tracks = [];
  doc.channels = {};
  doc.assets = {};
  doc.mediaClips = {};
  doc.scenes = { main: { start: 0, duration, rootIds: [] } };
  await copyFile(path.join(fixture.folder, "assets/NotoSansKR.ttf"), path.join(folder, "assets/font.ttf"));
  doc.assets.font = {
    kind: "font",
    logicalPath: "assets/font.ttf",
    sha256: await hashFile(path.join(folder, "assets/font.ttf")),
    fontMetadata: { family: "MotiFrame Sans" },
  };
  const commandExits: { command: string; exitCode: number }[] = [];
  const ffmpeg = (args: string[], label: string) => {
    const result = spawnSync("ffmpeg", args, { stdio: "pipe" });
    commandExits.push({ command: label, exitCode: result.status ?? 1 });
    if (result.error || result.status !== 0) throw new Error(`${label} failed`);
  };
  for (let i = 0; i < 2; i++) {
    const relative = `assets/video-${i}.mp4`,
      file = path.join(folder, relative);
    ffmpeg(
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=320x180:rate=30:duration=30`,
        "-vf",
        `hue=h=${i * 90}`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        file,
      ],
      `generate 30 second CFR video ${i}`,
    );
    const id = `video-${i}`;
    doc.assets[id] = { kind: "video", logicalPath: relative, sha256: await hashFile(file) };
    doc.instances[id] = {
      definitionId: "video",
      definitionRevision: 1,
      parentId: null,
      slotId: null,
      trackId: id,
      start: 0,
      duration,
      props: { assetId: id, width: 640, height: 360 },
      locked: false,
    };
    doc.tracks.push({ id, kind: "video", instanceIds: [id], locked: false, muted: false });
    doc.mediaClips[id] = { assetId: id, sourceIn: 0, sourceOut: duration, rate: { num: 1, den: 1 }, gain: 0 };
    doc.scenes.main.rootIds.push(id);
    doc.channels[`${id}:x`] = {
      target: { instanceId: id, targetKey: "root", channel: "x" },
      owner: "manual",
      locked: false,
      keys: [{ id: `${id}-x`, at: 0, value: i * 640, interpolation: "hold" }],
    };
  }
  const graphics: string[] = [];
  for (let i = 0; i < 30; i++) {
    const id = `graphic-${i}`,
      text = i % 2 === 0,
      definitionId = text ? "title" : "wipe";
    graphics.push(id);
    doc.scenes.main.rootIds.push(id);
    doc.instances[id] = {
      definitionId,
      definitionRevision: 1,
      parentId: null,
      slotId: null,
      trackId: "graphics",
      start: 0,
      duration,
      props: text
        ? {
            text: `M${i + 1}`,
            fontFamily: "MotiFrame Sans",
            fontSize: 28,
            color: "#ffffff",
            width: 140,
            height: 64,
          }
        : { color: "#9aff6b", width: 80, height: 50 },
      locked: false,
    };
    for (const [channel, value] of [
      ["x", (i % 6) * 200 + 30],
      ["y", Math.floor(i / 6) * 130 + 30],
    ] as const)
      doc.channels[`${id}:${channel}`] = {
        target: { instanceId: id, targetKey: "root", channel },
        owner: "manual",
        locked: false,
        keys: [
          { id: `${id}-${channel}-0`, at: 0, value, interpolation: "linear" },
          { id: `${id}-${channel}-1`, at: duration - 8000, value: value + 30, interpolation: "linear" },
        ],
      };
  }
  doc.tracks.push({ id: "graphics", kind: "graphics", instanceIds: graphics, locked: false, muted: false });
  await writeFile(path.join(folder, "project.json"), JSON.stringify(doc, null, 2) + "\n");
  const engine = new PreviewEngine(folder),
    ticks = Array.from({ length: samples }, (_, i) => Math.floor((i * 900) / samples) * 8000),
    hardware = os.cpus()[0]?.model ?? "unknown",
    resolved = await runtime();
  let peakRss = process.memoryUsage().rss,
    firstImage: string | undefined;
  const failures: { tick: number; code: string }[] = [];
  const memoryBefore = process.memoryUsage(),
    cpuBefore = process.cpuUsage(),
    started = performance.now(),
    sampler = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 25);
  try {
    const measurements = await benchmarkFrameWorkload(
      ticks,
      async (tick) => {
        const result = await engine.frame(doc, tick);
        if (result.ok) {
          firstImage ??= result.value.image;
          return { ok: result.value.receipt.ready && result.value.receipt.tick === tick };
        }
        failures.push({ tick, code: result.error.code });
        return result;
      },
      {
        operation: "PreviewEngine.frame (Chromium layout + video decode + PNG capture/cache)",
        os: process.platform,
        osRelease: os.release(),
        arch: process.arch,
        cpu: hardware,
        totalMemoryBytes: os.totalmem(),
        power: process.env.MOTIFRAME_POWER_MODE ?? "unknown",
        runtime: process.version,
        width: 1280,
        height: 720,
        fps: 30,
        durationSeconds: 30,
        graphicsLayers: 30,
        simultaneousVideos: 2,
      },
    );
    const memoryAfter = process.memoryUsage(),
      cpu = process.cpuUsage(cpuBefore);
    peakRss = Math.max(peakRss, memoryAfter.rss);
    const report = {
      schemaVersion: 1,
      ok:
        failures.length === 0 && measurements.cold.failedFrames === 0 && measurements.warm.failedFrames === 0,
      ...measurements,
      runtimeHashes: resolved.hashes,
      commandExits,
      failures,
      resources: {
        durationMs: performance.now() - started,
        orchestratorRssBefore: memoryBefore.rss,
        orchestratorRssAfter: memoryAfter.rss,
        orchestratorPeakRss: peakRss,
        userCpuMs: cpu.user / 1000,
        systemCpuMs: cpu.system / 1000,
        scope: "Orchestrator process only. Chromium and FFmpeg child memory was not sampled.",
      },
      method: {
        cold: "First sampled seek sequence on a new engine; includes one-time stage and media preparation.",
        warm: "Repeat of exactly the same ticks on the same engine; frame-cache hits are allowed.",
        uiResponse: "Not measured by this script. These results do not establish editor input latency.",
      },
    };
    if (firstImage)
      await writeFile(path.join(folder, "sample.png"), Buffer.from(firstImage.split(",")[1], "base64"));
    await writeFile(path.join(folder, "report.json"), JSON.stringify(report, null, 2) + "\n");
    return { report, reportPath: path.relative(process.cwd(), path.join(folder, "report.json")) };
  } finally {
    clearInterval(sampler);
    await engine.close();
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const native = await runtime();
  if (process.execPath !== native.node && !process.env.MOTIFRAME_BENCHMARK_CHILD) {
    const child = spawnSync(native.node, ["--import", "tsx", fileURLToPath(import.meta.url)], {
      stdio: "inherit",
      env: { ...process.env, MOTIFRAME_BENCHMARK_CHILD: "1" },
    });
    process.exitCode = child.status ?? 1;
  } else {
    const { report, reportPath } = await benchmarkPreview();
    console.log(
      JSON.stringify({
        ok: report.ok,
        samples: report.samples,
        coldP95Ms: report.cold.p95Ms,
        warmP95Ms: report.warm.p95Ms,
        failedFrames: report.cold.failedFrames + report.warm.failedFrames,
        report: reportPath,
      }),
    );
    process.exitCode = report.ok ? 0 : 1;
  }
}
