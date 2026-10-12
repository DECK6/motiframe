import { stat } from "node:fs/promises";
import path from "node:path";
import { fail, ok, type Result } from "../../document/src/result";
import { mediaFailure, runMediaProcess } from "./process";

export type Rational = { num: number; den: number };
export type AssetMetadata = {
  duration: number;
  width: number;
  height: number;
  fps: Rational;
  sourceTimebase: Rational;
  rotation: number;
  vfr: boolean;
  streams: { codec_type: string; codec_name: string; sample_rate?: string }[];
  framePts: number[];
};
type ProbeStream = {
  codec_type: string;
  codec_name: string;
  sample_rate?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  time_base?: string;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
};
function rational(value: string | undefined, fallback: Rational): Rational {
  const [num, den] = (value ?? "").split("/").map(Number);
  return Number.isSafeInteger(num) && num > 0 && Number.isSafeInteger(den) && den > 0
    ? { num, den }
    : fallback;
}
export async function probeAsset(
  file: string,
  options: { signal?: AbortSignal } = {},
): Promise<Result<AssetMetadata>> {
  if (options.signal?.aborted) return fail("CANCELLED", "Media operation was cancelled");
  try {
    const filename = path.resolve(file);
    if (!(await stat(filename)).isFile()) return fail("MEDIA_IO", "Media input must be a file");
    const raw = await runMediaProcess(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        filename,
      ],
      options.signal,
    );
    if (!raw.ok) return raw;
    const info = JSON.parse(raw.value.toString()) as {
      streams: ProbeStream[];
      format: { duration?: string; format_name?: string };
    };
    const video = info.streams.find((s) => s.codec_type === "video"),
      audio = info.streams.find((s) => s.codec_type === "audio");
    if (!video && !audio) return fail("UNSUPPORTED_MEDIA", "No supported audio or video stream");
    const videoCodecs = new Set(["h264", "png", "mjpeg", "webp"]),
      audioCodecs = new Set([
        "aac",
        "mp3",
        "pcm_s16le",
        "pcm_s24le",
        "pcm_s32le",
        "pcm_f32le",
        "pcm_f64le",
        "pcm_u8",
      ]);
    if ((video && !videoCodecs.has(video.codec_name)) || (audio && !audioCodecs.has(audio.codec_name)))
      return fail("UNSUPPORTED_MEDIA", "Unsupported media codec");
    const sourceTimebase = rational(video?.time_base ?? audio?.time_base, { num: 1, den: 48000 });
    let framePts: number[] = [];
    if (video) {
      const frames = await runMediaProcess(
        "ffprobe",
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-select_streams",
          "v:0",
          "-show_frames",
          "-show_entries",
          "frame=best_effort_timestamp,best_effort_timestamp_time",
          "-of",
          "json",
          filename,
        ],
        options.signal,
      );
      if (!frames.ok) return frames;
      framePts = (
        JSON.parse(frames.value.toString()) as {
          frames: { best_effort_timestamp?: number; best_effort_timestamp_time?: string }[];
        }
      ).frames
        .map((f) =>
          f.best_effort_timestamp === undefined
            ? Number(f.best_effort_timestamp_time)
            : (f.best_effort_timestamp * sourceTimebase.num) / sourceTimebase.den,
        )
        .filter(Number.isFinite);
      if (!framePts.length) return fail("MEDIA_NO_FRAMES", "Video has no presentation timestamps");
      if (framePts.some((pts, i) => i > 0 && pts <= framePts[i - 1]))
        return fail("INVALID_MEDIA_PTS", "Source presentation timestamps must be strictly increasing");
    }
    const fps = rational(video?.avg_frame_rate, rational(video?.r_frame_rate, { num: 1, den: 1 }));
    const intervals = framePts.slice(1).map((pts, i) => pts - framePts[i]);
    const vfr =
      intervals.length > 1 &&
      intervals.reduce((a, b) => Math.max(a, b), -Infinity) -
        intervals.reduce((a, b) => Math.min(a, b), Infinity) >
        0.00001;
    const duration = Number(info.format.duration ?? video?.duration ?? audio?.duration ?? 0);
    const rotation = Number(
      video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0,
    );
    return ok({
      duration: Number.isFinite(duration) ? duration : 0,
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      fps,
      sourceTimebase,
      rotation: ((rotation % 360) + 360) % 360,
      vfr,
      streams: info.streams.map((s) => ({
        codec_type: s.codec_type,
        codec_name: s.codec_name,
        ...(s.sample_rate ? { sample_rate: s.sample_rate } : {}),
      })),
      framePts,
    });
  } catch (error) {
    return mediaFailure(error);
  }
}
