import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { beforeAll, expect, it } from "vitest";
import { prepareAsset } from "../../packages/media/src/prepare";
import { probeAsset } from "../../packages/media/src/probe";
import { expectOk } from "../helpers/result";

const folder = path.resolve("artifacts/media-prepare");
beforeAll(async () => {
  await mkdir(folder, { recursive: true });
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=64x48:rate=10:duration=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=1",
    "-vf",
    "select=eq(n\\,0)+eq(n\\,1)+eq(n\\,4)+eq(n\\,9)",
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    path.join(folder, "vfr.mp4"),
  ]);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-display_rotation:v:0",
    "90",
    "-i",
    path.join(folder, "vfr.mp4"),
    "-c",
    "copy",
    path.join(folder, "회전 영상.mp4"),
  ]);
});
it("prepares a display-oriented CFR proxy with a VFR source correspondence and reusable artifacts", async () => {
  const input = path.join(folder, "회전 영상.mp4"),
    options = {
      cacheDir: path.join(folder, "cache"),
      proxyFps: 30 as const,
      maxWidth: 128,
      thumbnailCount: 3,
      waveformBins: 12,
    };
  const result = expectOk(await prepareAsset(input, options));
  expect(result.asset.kind).toBe("video");
  expect(result.asset.mediaMetadata.rotation).toBe(90);
  expect(result.asset.mediaMetadata.vfr).toBe(true);
  expect(result.proxy).not.toBeNull();
  const proxy = expectOk(await probeAsset(result.proxy!.path));
  expect(proxy).toMatchObject({ width: 48, height: 64, rotation: 0, vfr: false, fps: { num: 30, den: 1 } });
  expect(result.sourceToProxyMap[6]).toEqual({ proxyTick: 48000, sourceTick: 24000, sourcePts: 0.1 });
  expect(result.sourceToProxyMap[15]).toEqual({ proxyTick: 120000, sourceTick: 96000, sourcePts: 0.4 });
  expect(result.waveform?.peaks).toHaveLength(12);
  expect(Math.max(...result.waveform!.peaks)).toBeGreaterThan(0.05);
  expect(result.thumbnails).toHaveLength(3);
  const thumb = PNG.sync.read(await readFile(result.thumbnails[0].path));
  expect([thumb.width, thumb.height]).toEqual([48, 64]);
  const before = (await stat(result.proxy!.path)).mtimeMs;
  const repeat = expectOk(await prepareAsset(input, options));
  expect(repeat).toEqual(result);
  expect((await stat(repeat.proxy!.path)).mtimeMs).toBe(before);
});
it("rejects invalid preparation settings and pre-aborted operations", async () => {
  expect(await prepareAsset(path.join(folder, "vfr.mp4"), { maxWidth: 0 })).toMatchObject({
    ok: false,
    error: { code: "INVALID_PREPARE_OPTIONS" },
  });
  const abort = new AbortController();
  abort.abort();
  expect(await prepareAsset(path.join(folder, "vfr.mp4"), { signal: abort.signal })).toMatchObject({
    ok: false,
    error: { code: "CANCELLED" },
  });
});

it("imports still PNG/JPEG/WebP and audio-only WAV/MP3 without a video proxy", async () => {
  for (const extension of ["png", "jpg", "webp"]) {
    const file = path.join(folder, `still.${extension}`);
    if (extension === "webp")
      await writeFile(
        file,
        Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"),
      );
    else
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=64x48",
        "-frames:v",
        "1",
        file,
      ]);
    const prepared = expectOk(await prepareAsset(file, { cacheDir: path.join(folder, "images-cache") }));
    expect(prepared.asset.kind).toBe("image");
    expect(prepared.proxy).toBeNull();
    expect(prepared.thumbnails).toHaveLength(1);
    expect(prepared.waveform).toBeNull();
  }
  for (const extension of ["wav", "mp3"]) {
    const file = path.join(folder, `tone.${extension}`);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=0.25",
      file,
    ]);
    const prepared = expectOk(
      await prepareAsset(file, { cacheDir: path.join(folder, "audio-cache"), waveformBins: 4 }),
    );
    expect(prepared.asset.kind).toBe("audio");
    expect(prepared.proxy).toBeNull();
    expect(prepared.thumbnails).toHaveLength(0);
    expect(prepared.waveform?.peaks).toHaveLength(4);
  }
});

it("proxy pixels correspond to the source PTS reported by the VFR map", async () => {
  const { decodeFrame } = await import("../../packages/media/src/decode");
  const input = path.join(folder, "회전 영상.mp4"),
    cacheDir = path.join(folder, "correspondence-cache");
  const prepared = expectOk(await prepareAsset(input, { cacheDir, thumbnailCount: 1, waveformBins: 4 }));
  const source = [];
  for (const pts of prepared.asset.mediaMetadata.framePts) {
    const frame = expectOk(await decodeFrame(input, Math.ceil(pts * 240000), { cacheDir }));
    source.push({ pts, data: PNG.sync.read(Buffer.from(frame.bitmap)).data });
  }
  for (const entry of prepared.sourceToProxyMap) {
    const frame = expectOk(await decodeFrame(prepared.proxy!.path, entry.proxyTick, { cacheDir }));
    const data = PNG.sync.read(Buffer.from(frame.bitmap)).data;
    const closest = source
      .map((s) => ({ pts: s.pts, error: s.data.reduce((total, n, i) => total + Math.abs(n - data[i]), 0) }))
      .sort((a, b) => a.error - b.error)[0];
    expect(closest.pts, `proxy tick ${entry.proxyTick}`).toBe(entry.sourcePts);
  }
});
