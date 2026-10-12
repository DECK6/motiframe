import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { captureProject } from "../apps/runner/src/capture";
import { runtime } from "../apps/runner/src/environment";
import { renderProject } from "../apps/runner/src/render-job";
import { packProject, unpackProject } from "../packages/document/src/bundle";
import { type ProjectDocument, projectSchema } from "../packages/document/src/schema";
import { hashFile } from "../packages/media/src/assets";

type Check = { name: string; ok: boolean; detail?: unknown };
type RenderEvidence = {
  name: string;
  ok: boolean;
  seconds: number;
  frames?: number;
  dimensions: [number, number];
  fps: number;
  range: { start: number; end: number };
  output: string;
  sha256?: string;
  checks: Check[];
  commands: { name: string; exit: number }[];
};
type Stream = {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  nb_read_frames?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
};
export async function runShowcaseSmoke(options: { outputDir?: string } = {}) {
  const root = process.cwd(),
    folder = path.resolve(options.outputDir ?? `artifacts/showcase-smoke/${Date.now()}`);
  await mkdir(folder, { recursive: true });
  const localRuntime = await runtime(),
    report = {
      schemaVersion: 1,
      ok: false,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      node: process.version,
      runtimeHashes: localRuntime.hashes,
      results: [] as RenderEvidence[],
      reportPath: path.relative(root, path.join(folder, "report.json")),
    };
  const save = () => writeFile(path.join(folder, "report.json"), JSON.stringify(report, null, 2) + "\n");
  async function run(
    name: string,
    doc: ProjectDocument,
    projectDir: string,
    range = { start: 0, end: doc.settings.duration },
    format: "mp4" | "png-sequence" = "mp4",
  ) {
    const outputPath = path.join(folder, `${name}${format === "mp4" ? ".mp4" : "-frames"}`),
      started = performance.now(),
      expectedFrames = Math.ceil(((range.end - range.start) * doc.settings.fps.num) / 240000);
    const evidence: RenderEvidence = {
      name,
      ok: false,
      seconds: 0,
      dimensions: [doc.settings.width, doc.settings.height],
      fps: doc.settings.fps.num,
      range,
      output: path.relative(root, outputPath),
      checks: [],
      commands: [],
    };
    const command = (program: string, args: string[], label: string) => {
      const result = spawnSync(program, args, {
        encoding: null,
        maxBuffer: 64 * 1024 ** 2,
        timeout: 120000,
        shell: false,
      });
      evidence.commands.push({ name: label, exit: result.status ?? 1 });
      if (result.error || result.status !== 0)
        throw new Error(`${label}: ${result.error?.message ?? result.stderr.toString()}`);
      return result.stdout;
    };
    try {
      const rendered = await renderProject(doc, {
        projectDir,
        outputPath,
        range,
        format,
        signal: AbortSignal.timeout(600000),
        onProgress: ({ completed, total }) => {
          if (completed === total || completed % 150 === 0)
            console.log(JSON.stringify({ name, completed, total }));
        },
      });
      if (!rendered.ok) throw new Error(`${rendered.error.code}: ${rendered.error.message}`);
      evidence.frames = rendered.value.frames;
      evidence.checks.push({
        name: "render frame count",
        ok: rendered.value.frames === expectedFrames,
        detail: expectedFrames,
      });
      const frameFolder =
          format === "png-sequence"
            ? outputPath
            : path.join(path.dirname(rendered.value.audioPath), "frames"),
        frames = (await readdir(frameFolder)).filter((file) => /^\d{6}\.png$/.test(file)).sort();
      evidence.checks.push({ name: "PNG source frame count", ok: frames.length === expectedFrames });
      const samples = [...new Set([0, Math.floor((expectedFrames - 1) / 2), expectedFrames - 1])],
        hashes: string[] = [];
      for (const frame of samples) {
        const source = path.join(frameFolder, `${String(frame).padStart(6, "0")}.png`),
          bytes = await readFile(source);
        hashes.push(await hashFile(source));
        evidence.checks.push({
          name: `PNG frame ${frame} dimensions`,
          ok: bytes.readUInt32BE(16) === doc.settings.width && bytes.readUInt32BE(20) === doc.settings.height,
        });
        await copyFile(source, path.join(folder, `${name}-${frame}.png`));
      }
      if (range.end - range.start >= 240000)
        evidence.checks.push({ name: "sampled frames change", ok: new Set(hashes).size > 1, detail: hashes });
      const pcm = command(
        "ffmpeg",
        ["-v", "error", "-i", rendered.value.audioPath, "-f", "f32le", "-ac", "1", "-ar", "48000", "pipe:1"],
        "decode mixed WAV",
      );
      let peak = 0,
        sumSquares = 0,
        nonFinite = false;
      for (let i = 0; i < pcm.length / 4; i++) {
        const sample = pcm.readFloatLE(i * 4);
        peak = Math.max(peak, Math.abs(sample));
        sumSquares += sample * sample;
        if (!Number.isFinite(sample)) nonFinite = true;
      }
      const samplesExpected = (range.end - range.start) / 5;
      evidence.checks.push({
        name: "48 kHz audio length and finite signal",
        ok: pcm.length / 4 === samplesExpected && !nonFinite,
        detail: {
          samples: pcm.length / 4,
          samplesExpected,
          peak,
          rms: Math.sqrt(sumSquares / (pcm.length / 4)),
        },
      });
      if (range.end - range.start >= 240000)
        evidence.checks.push({ name: "audible soundtrack", ok: peak > 0.01 && peak <= 1.001 });
      if (format === "mp4") {
        const probe = JSON.parse(
            command(
              "ffprobe",
              ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", outputPath],
              "ffprobe complete MP4",
            ).toString(),
          ) as { streams: Stream[] },
          video = probe.streams.find((stream) => stream.codec_type === "video"),
          audio = probe.streams.find((stream) => stream.codec_type === "audio");
        evidence.checks.push({
          name: "H264 dimensions, FPS and decoded frame count",
          ok:
            video?.codec_name === "h264" &&
            video.width === doc.settings.width &&
            video.height === doc.settings.height &&
            video.r_frame_rate === `${doc.settings.fps.num}/1` &&
            Number(video.nb_read_frames) === expectedFrames,
          detail: video,
        });
        evidence.checks.push({
          name: "AAC stereo 48 kHz duration",
          ok:
            audio?.codec_name === "aac" &&
            audio.sample_rate === "48000" &&
            audio.channels === 2 &&
            Math.abs(Number(audio.duration) - expectedFrames / doc.settings.fps.num) < 0.03,
          detail: audio,
        });
        command(
          "ffmpeg",
          ["-v", "error", "-i", outputPath, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"],
          "decode complete MP4 audio and video",
        );
        evidence.sha256 = await hashFile(outputPath);
        evidence.checks.push({
          name: "output content hash",
          ok: evidence.sha256 === rendered.value.outputHash,
        });
      } else {
        for (const frame of frames)
          command(
            "ffmpeg",
            ["-v", "error", "-i", path.join(outputPath, frame), "-f", "null", "-"],
            `decode PNG ${frame}`,
          );
        evidence.sha256 = hashes[0];
      }
    } catch (error) {
      evidence.checks.push({
        name: "render execution",
        ok: false,
        detail: String(error).replaceAll(root, "<project>").replaceAll(os.homedir(), "<home>"),
      });
    }
    evidence.seconds = (performance.now() - started) / 1000;
    evidence.ok =
      evidence.checks.length > 0 &&
      evidence.checks.every((check) => check.ok) &&
      evidence.commands.every((item) => item.exit === 0);
    report.results.push(evidence);
    await save();
    console.log(
      JSON.stringify({
        name,
        ok: evidence.ok,
        frames: evidence.frames,
        seconds: evidence.seconds,
        failures: evidence.checks.filter((check) => !check.ok),
      }),
    );
  }
  const documents = new Map<string, { document: ProjectDocument; projectDir: string }>();
  for (const name of ["hangul", "slow-tension", "mixed"]) {
    const projectDir = path.join(root, "examples/showcase", name),
      document = projectSchema.parse(
        JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")),
      );
    documents.set(name, { document, projectDir });
    await run(name, document, projectDir);
  }
  const mixed = documents.get("mixed");
  if (!mixed) throw new Error("Missing mixed showcase");
  for (const [aspect, width, height] of [
    ["wide", 1280, 720],
    ["portrait", 720, 1280],
    ["square", 1080, 1080],
  ] as const) {
    for (const fps of [24, 30, 60] as const) {
      const doc = structuredClone(mixed.document);
      doc.settings.width = width;
      doc.settings.height = height;
      doc.settings.fps = { num: fps, den: 1 };
      await run(`${aspect}-${fps}`, doc, mixed.projectDir, { start: 0, end: 80000 });
    }
  }
  await run("png-sequence", mixed.document, mixed.projectDir, { start: 0, end: 24000 }, "png-sequence");
  report.ok = report.results.length === 13 && report.results.every((result) => result.ok);
  await save();
  return report;
}
export async function verifyShowcaseBundles(evidenceDir: string) {
  const root = process.cwd(),
    folder = path.resolve(evidenceDir),
    verificationDir = path.join(folder, `portable-${Date.now()}`),
    renderReport = JSON.parse(await readFile(path.join(folder, "report.json"), "utf8")) as {
      results: RenderEvidence[];
    },
    results: {
      name: string;
      ok: boolean;
      checks: Check[];
      bundle?: string;
      bundleHash?: string;
      contactSheet?: string;
      reopenedFrame?: string;
      exportComparison?: { exact: boolean; changedPixels: number; maxChannelDelta: number };
    }[] = [];
  await mkdir(verificationDir, { recursive: true });
  for (const name of ["hangul", "slow-tension", "mixed"]) {
    const result: (typeof results)[number] = { name, ok: false, checks: [] };
    try {
      const original = renderReport.results.find((item) => item.name === name);
      if (!original?.ok || !original.frames)
        throw new Error("The full render must pass before portable verification");
      const projectDir = path.join(root, "examples/showcase", name),
        document = projectSchema.parse(
          JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")),
        ),
        bundlePath = path.join(verificationDir, `${name}.motionproj`),
        packed = await packProject(document, { projectDir, outputPath: bundlePath });
      if (!packed.ok) throw new Error(`${packed.error.code}: ${packed.error.message}`);
      result.bundle = path.relative(root, bundlePath);
      result.bundleHash = await hashFile(bundlePath);
      const reopenedDir = path.join(verificationDir, "다시 열린 프로젝트", name),
        reopened = await unpackProject(bundlePath, reopenedDir);
      if (!reopened.ok) throw new Error(`${reopened.error.code}: ${reopened.error.message}`);
      result.checks.push({
        name: "portable document round trip",
        ok: JSON.stringify(reopened.value) === JSON.stringify(document),
      });
      const frame = Math.floor((original.frames - 1) / 2),
        tick = frame * (240000 / document.settings.fps.num),
        captured = await captureProject(reopened.value, { tick, projectDir: reopenedDir });
      if (!captured.ok) throw new Error(`${captured.error.code}: ${captured.error.message}`);
      const screenshot = path.join(verificationDir, `${name}-reopened.png`);
      await writeFile(screenshot, captured.value.png);
      result.reopenedFrame = path.relative(root, screenshot);
      const originalCapture = await captureProject(document, { tick, projectDir });
      if (!originalCapture.ok)
        throw new Error(`${originalCapture.error.code}: ${originalCapture.error.message}`);
      const originalScreenshot = path.join(verificationDir, `${name}-original.png`);
      await writeFile(originalScreenshot, originalCapture.value.png);
      result.checks.push({
        name: "reopened custom elements, fonts and media render identically",
        ok: (await hashFile(screenshot)) === (await hashFile(originalScreenshot)),
        detail: { tick, receiptReady: captured.value.receipt.ready },
      });
      const exported = PNG.sync.read(await readFile(path.join(folder, `${name}-${frame}.png`))),
        direct = PNG.sync.read(Buffer.from(captured.value.png));
      let changedPixels = 0,
        maxChannelDelta = 0;
      for (let pixel = 0; pixel < exported.width * exported.height; pixel++) {
        let changed = false;
        for (let channel = 0; channel < 4; channel++) {
          const delta = Math.abs(exported.data[pixel * 4 + channel] - direct.data[pixel * 4 + channel]);
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          if (delta) changed = true;
        }
        if (changed) changedPixels++;
      }
      result.exportComparison = { exact: changedPixels === 0, changedPixels, maxChannelDelta };
      const contact = path.join(verificationDir, `${name}-contact-sheet.png`),
        frameCount = original.frames,
        selections = Array.from({ length: 9 }, (_, index) => Math.round((index * (frameCount - 1)) / 8)),
        filter = `select=${selections.map((index) => `eq(n\\,${index})`).join("+")},scale=320:180,tile=3x3`,
        command = spawnSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-i",
            path.resolve(root, original.output),
            "-vf",
            filter,
            "-frames:v",
            "1",
            "-update",
            "1",
            contact,
          ],
          { encoding: "utf8", timeout: 120000, shell: false },
        );
      result.checks.push({
        name: "contact sheet extraction",
        ok: command.status === 0,
        detail: { exit: command.status, frameIndices: selections },
      });
      if (command.status !== 0)
        throw new Error(command.stderr || command.error?.message || "Contact sheet failed");
      const png = await readFile(contact);
      result.checks.push({
        name: "nine-frame contact sheet dimensions",
        ok: png.readUInt32BE(16) === 960 && png.readUInt32BE(20) === 540,
      });
      result.contactSheet = path.relative(root, contact);
    } catch (error) {
      result.checks.push({
        name: "portable verification execution",
        ok: false,
        detail: String(error).replaceAll(root, "<project>").replaceAll(os.homedir(), "<home>"),
      });
    }
    result.ok = result.checks.length > 0 && result.checks.every((check) => check.ok);
    results.push(result);
    console.log(
      JSON.stringify({ name, portableOk: result.ok, failures: result.checks.filter((check) => !check.ok) }),
    );
  }
  const report = {
    ok: results.length === 3 && results.every((result) => result.ok),
    results,
    reportPath: path.relative(root, path.join(verificationDir, "report.json")),
  };
  await writeFile(path.join(verificationDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const native = await runtime();
  if (process.execPath !== native.node && !process.env.MOTIFRAME_SHOWCASE_CHILD) {
    const child = spawnSync(
      native.node,
      ["--import", "tsx", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      {
        stdio: "inherit",
        env: { ...process.env, MOTIFRAME_SHOWCASE_CHILD: "1" },
      },
    );
    process.exitCode = child.status ?? 1;
  } else {
    const existing = process.argv.indexOf("--verify-existing");
    if (existing >= 0) {
      const folder = process.argv[existing + 1];
      if (!folder) throw new Error("--verify-existing requires a showcase evidence directory");
      const portable = await verifyShowcaseBundles(folder);
      console.log(JSON.stringify({ ok: portable.ok, report: portable.reportPath }));
      process.exitCode = portable.ok ? 0 : 1;
    } else {
      const report = await runShowcaseSmoke(),
        portable = report.ok ? await verifyShowcaseBundles(path.dirname(report.reportPath)) : undefined;
      console.log(
        JSON.stringify({
          ok: report.ok && portable?.ok,
          report: report.reportPath,
          portable: portable?.reportPath,
        }),
      );
      process.exitCode = report.ok && portable?.ok ? 0 : 1;
    }
  }
}
