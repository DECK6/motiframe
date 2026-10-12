import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { probeAsset } from "../../packages/media/src/probe";
import { expectOk } from "../helpers/result";

const folder = path.resolve("artifacts/media-tests");
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
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    path.join(folder, "cfr.mp4"),
  ]);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    path.join(folder, "cfr.mp4"),
    "-vf",
    "select=eq(n\\,0)+eq(n\\,1)+eq(n\\,4)+eq(n\\,9)",
    "-fps_mode",
    "vfr",
    "-an",
    path.join(folder, "vfr.mp4"),
  ]);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-display_rotation:v:0",
    "90",
    "-i",
    path.join(folder, "cfr.mp4"),
    "-c",
    "copy",
    path.join(folder, "rotated.mp4"),
  ]);
});
it("probes source PTS, all streams, source timebase and VFR", async () => {
  const cfr = expectOk(await probeAsset(path.join(folder, "cfr.mp4")));
  expect(cfr).toMatchObject({ width: 64, height: 48, rotation: 0, vfr: false, fps: { num: 10, den: 1 } });
  expect(cfr.duration).toBeCloseTo(1, 4);
  expect(cfr.framePts).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
  expect(cfr.streams.find((s) => s.codec_type === "audio")?.sample_rate).toBe("48000");
  const vfr = expectOk(await probeAsset(path.join(folder, "vfr.mp4")));
  expect(vfr.vfr).toBe(true);
  expect(vfr.framePts).toEqual([0, 0.1, 0.4, 0.9]);
  expect(expectOk(await probeAsset(path.join(folder, "rotated.mp4"))).rotation).toBe(90);
});
it("normalizes missing and unsupported inputs as Result errors", async () => {
  expect(await probeAsset(path.join(folder, "missing.mp4"))).toMatchObject({
    ok: false,
    error: { code: "MEDIA_IO" },
  });
});

it("preserves rational source PTS precision instead of ffprobe decimal rounding", async () => {
  const file = path.join(folder, "rational.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=64x48:rate=30:duration=1",
    "-c:v",
    "libx264",
    file,
  ]);
  const result = expectOk(await probeAsset(file));
  expect(result.framePts[1]).toBe(1 / 30);
});

it("rejects unsupported video codecs explicitly", async () => {
  const file = path.join(folder, "unsupported.mkv");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=s=16x16:d=0.1",
    "-c:v",
    "ffv1",
    file,
  ]);
  expect(await probeAsset(file)).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_MEDIA" } });
});
