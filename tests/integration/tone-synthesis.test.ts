import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { synthesizeToneScore } from "../../apps/runner/src/tone-synthesis";
import { probeAsset } from "../../packages/media/src/probe";
import { expectOk } from "../helpers/result";

it("renders Tone offline in the sandbox with sample-accurate onset, silence and repeatable WAV bytes", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "motiframe-tone-"));
  const score = {
    durationTicks: 240000,
    sampleRate: 48000,
    startTick: 480000,
    instrument: "sine",
    attackTicks: 0,
    releaseTicks: 12000,
    notes: [{ at: 60000, duration: 60000, pitch: 440, velocity: 0.6 }],
  };
  const first = expectOk(await synthesizeToneScore(score, { projectDir }));
  expect(first.samples).toBe(48000);
  expect(first.durationTicks).toBe(240000);
  expect(first.score.startTick).toBe(480000);
  const bytes = await readFile(join(projectDir, first.asset.logicalPath));
  const pcm = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(pcm.getUint32(40, true)).toBe(48000 * 2 * 4);
  let firstSound = -1,
    lastSound = -1,
    peak = 0;
  for (let sample = 0; sample < 48000; sample++) {
    const value = Math.abs(pcm.getFloat32(44 + sample * 8, true));
    if (value > 1e-6) {
      if (firstSound < 0) firstSound = sample;
      lastSound = sample;
    }
    peak = Math.max(peak, value);
  }
  expect(firstSound).toBeGreaterThanOrEqual(12000);
  expect(firstSound).toBeLessThan(12010);
  expect(lastSound).toBeLessThanOrEqual(26400);
  expect(peak).toBeGreaterThan(0.05);
  expect(peak).toBeLessThan(1);
  const second = expectOk(await synthesizeToneScore(score, { projectDir }));
  expect(second.assetId).toBe(first.assetId);
  const metadata = expectOk(await probeAsset(join(projectDir, first.asset.logicalPath)));
  expect(metadata.duration).toBe(1);
  expect(metadata.streams[0].codec_name).toBe("pcm_f32le");
}, 60000);
it("preserves a 27-sample duration despite fractional seconds rounding", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "motiframe-tone-small-"));
  const result = expectOk(await synthesizeToneScore({ durationTicks: 135, notes: [] }, { projectDir }));
  expect(result.samples).toBe(27);
  expect((await readFile(join(projectDir, result.asset.logicalPath))).length).toBe(44 + 27 * 8);
}, 60000);
