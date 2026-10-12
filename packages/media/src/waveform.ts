import path from "node:path";
import { fail, ok, type Result } from "../../document/src/result";
import { runMediaProcess } from "./process";
export type Waveform = { sampleRate: 48000; channels: 1; peaks: number[] };
export async function createWaveform(
  file: string,
  bins: number,
  signal?: AbortSignal,
): Promise<Result<Waveform>> {
  if (!Number.isSafeInteger(bins) || bins < 1 || bins > 100000)
    return fail("INVALID_PREPARE_OPTIONS", "Waveform bins must be between 1 and 100000");
  const decoded = await runMediaProcess(
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
      "0:a:0",
      "-f",
      "f32le",
      "-ac",
      "1",
      "-ar",
      "48000",
      "pipe:1",
    ],
    signal,
  );
  if (!decoded.ok) return decoded;
  const count = decoded.value.length / 4,
    peaks = Array<number>(bins).fill(0);
  for (let i = 0; i < count; i++) {
    const bin = Math.min(bins - 1, Math.floor((i * bins) / count));
    peaks[bin] = Math.max(peaks[bin], Math.abs(decoded.value.readFloatLE(i * 4)));
  }
  return ok({ sampleRate: 48000, channels: 1, peaks });
}
