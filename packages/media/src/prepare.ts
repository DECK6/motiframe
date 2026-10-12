import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fail, ok, type Result } from "../../document/src/result";
import { hashFile } from "./assets";
import { decodeFrame } from "./decode";
import { type AssetMetadata, probeAsset } from "./probe";
import { mediaFailure } from "./process";
import { createProxy, type SourceProxyEntry, sourceTickAt } from "./proxy";
import { createWaveform, type Waveform } from "./waveform";
export type PrepareOptions = {
  cacheDir?: string;
  proxyFps?: 24 | 30 | 60;
  maxWidth?: number;
  waveformBins?: number;
  thumbnailCount?: number;
  signal?: AbortSignal;
};
export type PreparedAsset = {
  asset: { sha256: string; kind: "video" | "audio" | "image"; mediaMetadata: AssetMetadata };
  proxy: { path: string; fps: { num: number; den: number }; rotationApplied: true } | null;
  sourceToProxyMap: SourceProxyEntry[];
  waveform: Waveform | null;
  thumbnails: { path: string; sourceTick: number; pts: number }[];
};
export async function prepareAsset(
  file: string,
  options: PrepareOptions = {},
): Promise<Result<PreparedAsset>> {
  if (options.signal?.aborted) return fail("CANCELLED", "Media operation was cancelled");
  const fps = options.proxyFps ?? 30,
    maxWidth = options.maxWidth ?? 960,
    bins = options.waveformBins ?? 256,
    count = options.thumbnailCount ?? 5;
  if (
    ![24, 30, 60].includes(fps) ||
    !Number.isSafeInteger(maxWidth) ||
    maxWidth < 2 ||
    maxWidth > 8192 ||
    !Number.isSafeInteger(bins) ||
    bins < 1 ||
    bins > 100000 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 100
  )
    return fail("INVALID_PREPARE_OPTIONS", "Invalid proxy dimensions, fps, waveform bins or thumbnail count");
  try {
    const sha256 = await hashFile(path.resolve(file), options.signal),
      cacheDir = path.resolve(options.cacheDir ?? "artifacts/media-cache");
    const folder = path.join(cacheDir, sha256, `prepare-v2-${fps}-${maxWidth}-${bins}-${count}`),
      manifest = path.join(folder, "prepared.json");
    try {
      const cached = JSON.parse(await readFile(manifest, "utf8")) as PreparedAsset;
      if (cached.asset.sha256 === sha256) {
        const files = [...(cached.proxy ? [cached.proxy.path] : []), ...cached.thumbnails.map((t) => t.path)];
        const valid = await Promise.all(
          files.map(async (f) => f.startsWith(`${folder}${path.sep}`) && (await stat(f)).isFile()),
        );
        if (valid.every(Boolean)) return ok(cached);
      }
    } catch {
      /* Cache absent or incomplete; publish only after all artifacts succeed. */
    }
    const metadata = await probeAsset(file, { signal: options.signal });
    if (!metadata.ok) return metadata;
    const video = metadata.value.streams.find((s) => s.codec_type === "video"),
      audio = metadata.value.streams.some((s) => s.codec_type === "audio");
    const kind = !video
      ? "audio"
      : ["png", "mjpeg", "webp"].includes(video.codec_name) && metadata.value.framePts.length === 1
        ? "image"
        : "video";
    const asset: PreparedAsset["asset"] = { sha256, kind, mediaMetadata: metadata.value };
    const run = path.join(folder, randomUUID());
    await mkdir(run, { recursive: true });
    let proxy: PreparedAsset["proxy"] = null,
      sourceToProxyMap: SourceProxyEntry[] = [];
    if (kind === "video") {
      const result = await createProxy(file, path.join(run, "proxy.mp4"), metadata.value, {
        fps,
        maxWidth,
        signal: options.signal,
      });
      if (!result.ok) return result;
      const { map, ...descriptor } = result.value;
      proxy = descriptor;
      sourceToProxyMap = map;
    }
    let waveform: Waveform | null = null;
    if (audio) {
      const result = await createWaveform(file, bins, options.signal);
      if (!result.ok) return result;
      waveform = result.value;
    }
    const thumbnails: PreparedAsset["thumbnails"] = [];
    if (video) {
      const unique = new Set<number>();
      for (let i = 0; i < Math.min(count, metadata.value.framePts.length); i++)
        unique.add(
          Math.floor(
            (i * (metadata.value.framePts.length - 1)) /
              Math.max(1, Math.min(count, metadata.value.framePts.length) - 1),
          ),
        );
      for (const index of unique) {
        const sourceTick = sourceTickAt(metadata.value.framePts[index]);
        const frame = await decodeFrame(file, sourceTick, { cacheDir, signal: options.signal });
        if (!frame.ok) return frame;
        const output = path.join(run, `thumbnail-${index}.png`);
        await writeFile(output, frame.value.bitmap);
        thumbnails.push({ path: output, sourceTick, pts: frame.value.pts });
      }
    }
    if (options.signal?.aborted) return fail("CANCELLED", "Media operation was cancelled");
    const prepared: PreparedAsset = { asset, proxy, sourceToProxyMap, waveform, thumbnails },
      temporary = path.join(run, "prepared.json");
    await writeFile(temporary, JSON.stringify(prepared));
    await rename(temporary, manifest);
    return ok(prepared);
  } catch (error) {
    return options.signal?.aborted ? fail("CANCELLED", "Media operation was cancelled") : mediaFailure(error);
  }
}
