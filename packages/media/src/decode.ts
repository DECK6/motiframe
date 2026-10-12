import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fail, ok, type Result } from "../../document/src/result";
import { hashFile } from "./assets";
import { type AssetMetadata, probeAsset } from "./probe";
import { mediaFailure, runMediaProcess } from "./process";
import { isTick } from "./time-map";

/** PNG bytes are display oriented; pts remains original source seconds. */
export type DecodedFrame = { pts: number; sourceTimebase: { num: number; den: number }; bitmap: Uint8Array };
type FrameCache = { metadata: AssetMetadata; directory: string };
const pending = new Map<string, Promise<Result<FrameCache>>>();
const ready = new Map<string, FrameCache>();
export function selectSourceFrame(framePts: number[], seconds: number): number {
  let lo = 0,
    hi = framePts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (framePts[mid] <= seconds + 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
async function extract(file: string, folder: string, signal?: AbortSignal): Promise<Result<FrameCache>> {
  try {
    const manifest = JSON.parse(await readFile(path.join(folder, "frames.json"), "utf8")) as {
      version: number;
      run: string;
      metadata: AssetMetadata;
    };
    if (manifest.version === 2 && /^[a-z0-9-]+$/.test(manifest.run) && manifest.metadata.framePts.length) {
      const directory = path.join(folder, manifest.run);
      const frames = await readdir(directory);
      if (frames.filter((f) => /^frame-\d{8}\.png$/.test(f)).length === manifest.metadata.framePts.length)
        return ok({ directory, metadata: manifest.metadata });
    }
  } catch {
    /* Incomplete extraction has no usable manifest. Keep it for recovery inspection. */
  }
  const metadata = await probeAsset(file, { signal });
  if (!metadata.ok) return metadata;
  if (!metadata.value.framePts.length) return fail("MEDIA_NO_FRAMES", "Media has no video frames");
  if (metadata.value.width * metadata.value.height * 4 * metadata.value.framePts.length > 8 * 1024 ** 3)
    return fail("MEDIA_BUDGET_EXCEEDED", "Decoded frame cache exceeds the 8 GiB preparation budget");
  try {
    const run = randomUUID(),
      directory = path.join(folder, run);
    await mkdir(directory, { recursive: true });
    const result = await runMediaProcess(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        path.resolve(file),
        "-map",
        "0:v:0",
        "-an",
        "-fps_mode",
        "passthrough",
        "-start_number",
        "0",
        path.join(directory, "frame-%08d.png"),
      ],
      signal,
    );
    if (!result.ok) return result;
    if ((await readdir(directory)).length !== metadata.value.framePts.length)
      return fail("FRAME_COUNT_MISMATCH", "Decoded frame count does not match source PTS");
    const temporary = path.join(folder, `${run}.json`);
    await writeFile(temporary, JSON.stringify({ version: 2, run, metadata: metadata.value }));
    await rename(temporary, path.join(folder, "frames.json"));
    return ok({ directory, metadata: metadata.value });
  } catch (error) {
    return mediaFailure(error);
  }
}
export async function decodeFrame(
  file: string,
  sourceTick: number,
  options: { cacheDir?: string; signal?: AbortSignal } = {},
): Promise<Result<DecodedFrame>> {
  if (options.signal?.aborted) return fail("CANCELLED", "Media operation was cancelled");
  if (!isTick(sourceTick))
    return fail("INVALID_MEDIA_TIME", "Source time must be a nonnegative integer tick");
  try {
    const hash = await hashFile(path.resolve(file), options.signal);
    const folder = path.resolve(options.cacheDir ?? "artifacts/media-cache", hash, "frames-v2");
    let cached = ready.get(folder);
    if (!cached) {
      let work = pending.get(folder);
      if (!work) {
        work = extract(file, folder, options.signal);
        pending.set(folder, work);
      }
      const result = await work;
      pending.delete(folder);
      if (!result.ok) return result;
      cached = result.value;
      ready.set(folder, cached);
    }
    if (options.signal?.aborted) return fail("CANCELLED", "Media operation was cancelled");
    const seconds = sourceTick / 240000,
      index = selectSourceFrame(cached.metadata.framePts, seconds);
    if (index < 0 || (cached.metadata.duration > 0 && seconds >= cached.metadata.duration))
      return fail("SOURCE_OUT_OF_RANGE", "Source timestamp lies outside the media");
    return ok({
      pts: cached.metadata.framePts[index],
      sourceTimebase: cached.metadata.sourceTimebase,
      bitmap: await readFile(path.join(cached.directory, `frame-${String(index).padStart(8, "0")}.png`)),
    });
  } catch (error) {
    return options.signal?.aborted ? fail("CANCELLED", "Media operation was cancelled") : mediaFailure(error);
  }
}
