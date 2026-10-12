import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, it } from "vitest";
import { renderProject } from "../../apps/runner/src/render-job";
import { createMixedFixture } from "../../scripts/create-fixtures";
import { expectOk } from "../helpers/result";

it("exports 180 mixed frames and places source audio pulse at sample 72000", async () => {
  const fixture = await createMixedFixture();
  const output = path.resolve(`artifacts/T04/${randomUUID()}-mixed-phrase.mp4`);
  const result = expectOk(
    await renderProject(fixture.project, { projectDir: fixture.folder, outputPath: output }),
  );
  expect(result.frames).toBe(180);
  expect(result.durationTicks).toBe(1440000);
  const probe = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-of", "json", output], {
      encoding: "utf8",
    }),
  );
  const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  expect(Number(video.nb_read_frames)).toBe(180);
  expect(video.r_frame_rate).toBe("30/1");
  const pcm = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", result.audioPath, "-f", "f32le", "-ac", "1", "-ar", "48000", "pipe:1"],
    { maxBuffer: 10_000_000 },
  );
  let first = -1;
  for (let i = 0; i < pcm.length / 4; i++)
    if (Math.abs(pcm.readFloatLE(i * 4)) > 0.1) {
      first = i;
      break;
    }
  expect(first).toBe(72000);
  const encoded = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", output, "-vn", "-f", "f32le", "-ac", "1", "-ar", "48000", "pipe:1"],
    { maxBuffer: 10_000_000 },
  );
  let peak = 0,
    index = 0;
  for (let i = 0; i < encoded.length / 4; i++) {
    const v = Math.abs(encoded.readFloatLE(i * 4));
    if (v > peak) {
      peak = v;
      index = i;
    }
  }
  expect(Math.abs(index - 72000)).toBeLessThanOrEqual(1600);
  execFileSync("ffmpeg", ["-v", "error", "-i", output, "-f", "null", "-"]);
}, 120000);
