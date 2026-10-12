import { expect, it } from "vitest";
import { encodePcmWav, parseToneScore } from "../../packages/authoring/src/tone";
import { expectOk } from "../helpers/result";

it("keeps synthesis time separate from project placement and requires exact sample alignment", () => {
  const score = expectOk(
    parseToneScore({
      durationTicks: 240000,
      sampleRate: 48000,
      startTick: 480000,
      notes: [{ at: 60000, duration: 120000, pitch: "A4" }],
    }),
  );
  expect(score.startTick).toBe(480000);
  expect(score.notes[0].at).toBe(60000);
  expect(score.attackTicks).toBe(2400);
  expect(parseToneScore({ ...score, durationTicks: 240001 }).ok).toBe(false);
  expect(parseToneScore({ ...score, notes: [{ at: 0, duration: 239995, pitch: "A4" }] }).ok).toBe(false);
  expect(parseToneScore({ ...score, notes: [{ at: 0, duration: 100, pitch: "../../script.js" }] }).ok).toBe(
    false,
  );
  expect(parseToneScore({ ...score, source: "execute()" }).ok).toBe(false);
});
it("encodes interleaved stereo IEEE float PCM with complete WAV duration and rejects invalid samples", () => {
  const bytes = expectOk(encodePcmWav([new Float32Array([0.25, -0.5]), new Float32Array([0.75, -1])], 48000));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    decoder = new TextDecoder();
  expect(decoder.decode(bytes.slice(0, 4))).toBe("RIFF");
  expect(view.getUint32(4, true)).toBe(bytes.length - 8);
  expect(view.getUint16(20, true)).toBe(3);
  expect(view.getUint16(22, true)).toBe(2);
  expect(view.getUint32(24, true)).toBe(48000);
  expect(view.getUint32(40, true)).toBe(16);
  expect([44, 48, 52, 56].map((at) => view.getFloat32(at, true))).toEqual([0.25, 0.75, -0.5, -1]);
  expect(encodePcmWav([new Float32Array([Number.NaN])], 48000).ok).toBe(false);
  expect(encodePcmWav([new Float32Array(2), new Float32Array(1)], 48000).ok).toBe(false);
});
