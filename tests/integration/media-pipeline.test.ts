import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { beforeAll, expect, it } from "vitest";
import type { ProjectDocument } from "../../packages/document/src/schema";
import { mixAudio } from "../../packages/media/src/audio-mix";
import { decodeFrame } from "../../packages/media/src/decode";
import { expectOk } from "../helpers/result";

const folder = path.resolve("artifacts/media-pipeline");
function wav(samples: number, value: (i: number) => number) {
  const b = Buffer.alloc(44 + samples * 4);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(192000, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples * 4, 40);
  for (let i = 0; i < samples; i++) {
    b.writeInt16LE(value(i), 44 + i * 4);
    b.writeInt16LE(value(i), 46 + i * 4);
  }
  return b;
}
let doc: ProjectDocument;
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
    "-vf",
    "select=eq(n\\,0)+eq(n\\,1)+eq(n\\,4)+eq(n\\,9)",
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    path.join(folder, "vfr.mp4"),
  ]);
  const pulse = wav(96000, (i) => (i === 24000 ? 24576 : 0));
  await writeFile(path.join(folder, "펄스 소스.wav"), pulse);
  doc = JSON.parse(await readFile("tests/fixtures/mixed-phrase/project.json", "utf8")) as ProjectDocument;
  doc.mediaClips = {
    audio: { assetId: "pulse", sourceIn: 0, sourceOut: 480000, rate: { num: 1, den: 1 }, gain: 1 },
  };
  doc.assets = {
    pulse: {
      kind: "audio",
      logicalPath: "펄스 소스.wav",
      sha256: createHash("sha256").update(pulse).digest("hex"),
    },
  };
  doc.channels = {};
});
it("decodes actual source PTS on reverse seeks and reuses extracted PNG frames", async () => {
  const file = path.join(folder, "vfr.mp4"),
    cacheDir = path.join(folder, "cache");
  const late = expectOk(await decodeFrame(file, 120000, { cacheDir }));
  expect(late.pts).toBe(0.4);
  expect(PNG.sync.read(Buffer.from(late.bitmap)).width).toBe(64);
  const early = expectOk(await decodeFrame(file, 12000, { cacheDir }));
  expect(early.pts).toBe(0);
  expect(late.bitmap).not.toEqual(early.bitmap);
  const again = expectOk(await decodeFrame(file, 120000, { cacheDir }));
  expect(again.bitmap).toEqual(late.bitmap);
  expect(await decodeFrame(file, 240000, { cacheDir })).toMatchObject({
    ok: false,
    error: { code: "SOURCE_OUT_OF_RANGE" },
  });
  const abort = new AbortController();
  abort.abort();
  expect(await decodeFrame(file, 0, { signal: abort.signal })).toMatchObject({
    ok: false,
    error: { code: "CANCELLED" },
  });
});
it("mixes the source pulse at sample 72000 and respects partial export ranges", async () => {
  const output = expectOk(
    await mixAudio(
      doc,
      { start: 0, end: 1440000 },
      { projectDir: folder, outputPath: path.join(folder, "mixed.wav") },
    ),
  );
  const pcm = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", output.path, "-f", "f32le", "-af", "pan=mono|c0=c0", "pipe:1"],
    { maxBuffer: 3_000_000 },
  );
  expect(pcm.length / 4).toBe(288000);
  const nonzero = Array.from({ length: pcm.length / 4 }, (_, i) =>
    Math.abs(pcm.readFloatLE(i * 4)),
  ).findIndex((x) => x > 0.1);
  expect(nonzero).toBe(72000);
  const partial = expectOk(
    await mixAudio(
      doc,
      { start: 300000, end: 480000 },
      { projectDir: folder, outputPath: path.join(folder, "partial.wav") },
    ),
  );
  const partialPcm = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    partial.path,
    "-f",
    "f32le",
    "-af",
    "pan=mono|c0=c0",
    "pipe:1",
  ]);
  expect(partialPcm.readFloatLE(12000 * 4)).toBeCloseTo(0.75, 3);
});
it("applies gain envelopes, mute, source trimming and rejects unsupported rates", async () => {
  const faded = structuredClone(doc);
  faded.channels = {
    fade: {
      target: { instanceId: "audio", targetKey: "root", channel: "gain" },
      owner: "manual",
      locked: false,
      keys: [
        { id: "start", at: 0, value: 0, interpolation: "linear" },
        { id: "end", at: 240000, value: 1, interpolation: "linear" },
      ],
    },
  };
  const output = expectOk(
    await mixAudio(
      faded,
      { start: 0, end: 720000 },
      { projectDir: folder, outputPath: path.join(folder, "faded.wav") },
    ),
  );
  const pcm = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    output.path,
    "-f",
    "f32le",
    "-af",
    "pan=mono|c0=c0",
    "pipe:1",
  ]);
  expect(pcm.readFloatLE(72000 * 4)).toBeCloseTo(0.375, 3);
  const muted = structuredClone(doc);
  muted.tracks.find((t) => t.id === "audio")!.muted = true;
  const silence = expectOk(
    await mixAudio(
      muted,
      { start: 0, end: 720000 },
      { projectDir: folder, outputPath: path.join(folder, "silence.wav") },
    ),
  );
  const silentPcm = execFileSync("ffmpeg", ["-v", "error", "-i", silence.path, "-f", "s16le", "pipe:1"]);
  expect(silentPcm.every((v) => v === 0)).toBe(true);
  const invalid = structuredClone(doc);
  invalid.mediaClips.audio = {
    assetId: "pulse",
    sourceIn: 0,
    sourceOut: 480000,
    rate: { num: 2, den: 1 },
    gain: 1,
  };
  expect(
    await mixAudio(
      invalid,
      { start: 0, end: 720000 },
      { projectDir: folder, outputPath: path.join(folder, "invalid.wav") },
    ),
  ).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_AUDIO_RATE" } });
});
it("rejects escaped, symlinked or tampered asset paths before creating output", async () => {
  for (const [logicalPath, hash, code] of [
    ["../media-pipeline/펄스 소스.wav", "a".repeat(64), "INVALID_ASSET_PATH"],
    ["펄스 소스.wav", "a".repeat(64), "ASSET_HASH_MISMATCH"],
  ] as const) {
    const bad = structuredClone(doc);
    bad.assets.pulse = { kind: "audio", logicalPath, sha256: hash };
    expect(
      await mixAudio(
        bad,
        { start: 0, end: 720000 },
        { projectDir: folder, outputPath: path.join(folder, "bad.wav") },
      ),
    ).toMatchObject({ ok: false, error: { code } });
  }
  const linked = path.join(folder, `link-${Date.now()}.wav`);
  await symlink(path.join(folder, "펄스 소스.wav"), linked);
  const bad = structuredClone(doc);
  bad.assets.pulse = { ...(doc.assets.pulse as object), logicalPath: path.basename(linked) };
  expect(
    await mixAudio(
      bad,
      { start: 0, end: 720000 },
      { projectDir: folder, outputPath: path.join(folder, "bad.wav") },
    ),
  ).toMatchObject({ ok: false, error: { code: "INVALID_ASSET_PATH" } });
  expect(await stat(path.join(folder, "bad.wav")).catch(() => null)).toBeNull();
});

it("trims source in and applies nested parent start offsets", async () => {
  const trimmed = structuredClone(doc);
  trimmed.mediaClips.audio = {
    assetId: "pulse",
    sourceIn: 60000,
    sourceOut: 480000,
    rate: { num: 1, den: 1 },
    gain: 0.5,
  };
  trimmed.instances.audio.parentId = "wipe";
  trimmed.instances.wipe.start = 120000;
  const output = expectOk(
    await mixAudio(
      trimmed,
      { start: 0, end: 960000 },
      { projectDir: folder, outputPath: path.join(folder, "nested.wav") },
    ),
  );
  const pcm = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    output.path,
    "-f",
    "f32le",
    "-af",
    "pan=mono|c0=c0",
    "pipe:1",
  ]);
  expect(pcm.readFloatLE(84000 * 4)).toBeCloseTo(0.375, 3);
});
it("permits non-unit playback rate for video with no audio stream", async () => {
  const silentVideo = structuredClone(doc);
  silentVideo.mediaClips = {
    video: { assetId: "video", sourceIn: 0, sourceOut: 240000, rate: { num: 2, den: 1 }, gain: 1 },
  };
  const data = await readFile(path.join(folder, "vfr.mp4"));
  silentVideo.assets = {
    video: { kind: "video", logicalPath: "vfr.mp4", sha256: createHash("sha256").update(data).digest("hex") },
  };
  expectOk(
    await mixAudio(
      silentVideo,
      { start: 0, end: 960000 },
      { projectDir: folder, outputPath: path.join(folder, "silent-video.wav") },
    ),
  );
});

it("aligns audio to its scene start as well as the instance start", async () => {
  const shifted = structuredClone(doc);
  shifted.scenes.main.start = 120000;
  const output = expectOk(
    await mixAudio(
      shifted,
      { start: 0, end: 960000 },
      { projectDir: folder, outputPath: path.join(folder, "scene-offset.wav") },
    ),
  );
  const pcm = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    output.path,
    "-f",
    "f32le",
    "-af",
    "pan=mono|c0=c0",
    "pipe:1",
  ]);
  expect(pcm.readFloatLE(96000 * 4)).toBeCloseTo(0.75, 3);
});
