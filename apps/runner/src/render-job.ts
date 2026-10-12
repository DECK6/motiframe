import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileProject } from "../../../packages/core/src/compile";
import { evaluateFrame } from "../../../packages/core/src/evaluate";
import { frameToTick } from "../../../packages/core/src/time";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import { mixAudio } from "../../../packages/media/src/audio-mix";
import { resolveAssets } from "./asset-broker";
import { loadDefinitionArtifacts } from "./definition-artifacts";
import { encodeMp4 } from "./encode";
import { runtime } from "./environment";
import { prepareFrame } from "./prepare-frame";
import { openStage } from "./stage-session";
export type RenderManifest = {
  revision: number;
  runtimeHashes: Record<string, string>;
  frames: number;
  fps: { num: number; den: number };
  durationTicks: number;
  assetsHash: string;
  outputHash: string;
  warnings: string[];
  outputPath: string;
  audioPath: string;
};
export type RenderOptions = {
  projectDir: string;
  outputPath: string;
  format?: "mp4" | "png-sequence";
  range?: { start: number; end: number };
  signal?: AbortSignal;
  onProgress?: (progress: { completed: number; total: number }) => void;
};
export async function renderProject(input: unknown, options: RenderOptions): Promise<Result<RenderManifest>> {
  const compiled = compileProject(input);
  if (!compiled.ok) return compiled;
  if (options.format !== undefined && !["mp4", "png-sequence"].includes(options.format))
    return fail("INVALID_FORMAT", "Choose mp4 or png-sequence");
  for (const candidate of [options.outputPath, `${options.outputPath}.manifest.json`])
    try {
      await lstat(candidate);
      return fail("OUTPUT_EXISTS", "Choose a new output path; existing files are preserved");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return fail("OUTPUT_IO", String(error));
    }
  const ir = compiled.value,
    doc = ir.document;
  const range = options.range ?? { start: 0, end: ir.duration };
  const step = frameToTick(1, doc.settings.fps);
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end > ir.duration ||
    range.end <= range.start ||
    range.start % step !== 0
  )
    return fail("INVALID_RENDER_RANGE", "Range must start on a frame and lie within the composition");
  const frames = Math.ceil((range.end - range.start) / step);
  const jobId = randomUUID();
  const jobDir = path.join(path.dirname(path.resolve(options.outputPath)), `.motiframe-render-${jobId}`);
  const framesDir = path.join(jobDir, "frames"),
    audioPath = path.join(jobDir, "audio.wav");
  let stage: Awaited<ReturnType<typeof openStage>> | undefined;
  try {
    options.signal?.throwIfAborted();
    const assets = await resolveAssets(doc, options.projectDir);
    if (!assets.ok) return assets;
    await mkdir(framesDir, { recursive: true });
    const definitions = await loadDefinitionArtifacts(doc, options.projectDir);
    if (!definitions.ok) return definitions;
    stage = await openStage(doc.settings.width, doc.settings.height, {
      definitions: definitions.value,
      signal: options.signal,
    });
    const activeStage = stage;
    const cancel = () => {
      void activeStage.close();
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const loaded = await stage.bounded(
        stage.page.evaluate(
          ({ document, stageAssets }) => window.motiframe.load(document, undefined, stageAssets),
          { document: doc, stageAssets: assets.value.stage },
        ),
        30000,
      );
      if (!loaded.ok) return loaded;
      for (let frame = 0; frame < frames; frame++) {
        options.signal?.throwIfAborted();
        const tick = range.start + frame * step;
        const frameToken = `${jobId}:${frame}`;
        const plan = evaluateFrame(ir, {
          tick,
          frame: Math.floor(tick / step),
          fps: doc.settings.fps,
          seed: doc.settings.seed,
          frameToken,
          documentRevision: doc.revision,
        });
        if (!plan.ok) return plan;
        const prepared = await prepareFrame(ir, plan.value, assets.value.files, {
          cacheDir: path.join(options.projectDir, ".motiframe/cache"),
          signal: options.signal,
        });
        if (!prepared.ok) return prepared;
        const receipt = await stage.bounded(
          stage.page.evaluate((p) => window.motiframe.renderFrame(p), prepared.value),
        );
        if (!receipt.ok) return receipt;
        if (receipt.value.frameToken !== frameToken || receipt.value.documentRevision !== doc.revision)
          return fail("STALE_FRAME", "Render receipt does not match request");
        await stage.page.screenshot({
          type: "png",
          path: path.join(framesDir, `${String(frame).padStart(6, "0")}.png`),
        });
        options.onProgress?.({ completed: frame + 1, total: frames });
      }
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      await stage.close();
      stage = undefined;
    }
    const audio = await mixAudio(doc, range, {
      projectDir: options.projectDir,
      outputPath: audioPath,
      signal: options.signal,
    });
    if (!audio.ok) return audio;
    const outputPath = path.resolve(options.outputPath);
    let outputHash: string;
    if (options.format === "png-sequence") {
      await rename(framesDir, outputPath);
      outputHash = createHash("sha256")
        .update(await readFile(path.join(outputPath, "000000.png")))
        .digest("hex");
    } else {
      const temporary = path.join(jobDir, "output.mp4");
      await encodeMp4({
        framesDir,
        audioPath,
        outputPath: temporary,
        fps: doc.settings.fps.num,
        frames,
        signal: options.signal,
      });
      options.signal?.throwIfAborted();
      // Publish atomically without replacing a file created during the render.
      await link(temporary, outputPath);
      outputHash = createHash("sha256")
        .update(await readFile(outputPath))
        .digest("hex");
    }
    const manifest: RenderManifest = {
      revision: doc.revision,
      runtimeHashes: (await runtime()).hashes,
      frames,
      fps: doc.settings.fps,
      durationTicks: range.end - range.start,
      assetsHash: assets.value.hash,
      outputHash,
      warnings: [],
      outputPath,
      audioPath,
    };
    await writeFile(`${outputPath}.manifest.json`, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    return ok(manifest);
  } catch (error) {
    return fail(
      options.signal?.aborted ? "CANCELLED" : "RENDER_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await stage?.close();
  }
}
