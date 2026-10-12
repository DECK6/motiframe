import { execFile } from "node:child_process";
export function runProcess(file: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(file, args, { signal, maxBuffer: 10_000_000 }, (error, _stdout, stderr) =>
      error ? reject(new Error(`${file}: ${stderr || error.message}`)) : resolve(),
    ),
  );
}
export async function encodeMp4(options: {
  framesDir: string;
  audioPath: string;
  outputPath: string;
  fps: number;
  frames: number;
  signal?: AbortSignal;
}) {
  await runProcess(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-framerate",
      String(options.fps),
      "-i",
      `${options.framesDir}/%06d.png`,
      "-i",
      options.audioPath,
      "-frames:v",
      String(options.frames),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "iec61966-2-1",
      "-colorspace",
      "bt709",
      "-movflags",
      "+faststart",
      options.outputPath,
    ],
    options.signal,
  );
}
