import path from "node:path";
import { ok, type Result } from "../../document/src/result";
import { selectSourceFrame } from "./decode";
import { type AssetMetadata, probeAsset } from "./probe";
import { runMediaProcess } from "./process";

export type SourceProxyEntry = { proxyTick: number; sourceTick: number; sourcePts: number };
/** First addressable project tick at or after this original timestamp; the exact PTS is retained separately. */
export const sourceTickAt = (pts: number) => Math.max(0, Math.ceil(pts * 240000 - 1e-7));
export async function createProxy(
  file: string,
  outputPath: string,
  metadata: AssetMetadata,
  options: { fps: 24 | 30 | 60; maxWidth: number; signal?: AbortSignal },
): Promise<
  Result<{ path: string; fps: { num: number; den: number }; rotationApplied: true; map: SourceProxyEntry[] }>
> {
  const result = await runMediaProcess(
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
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      `setpts=PTS-STARTPTS,fps=fps=${options.fps}:round=up,scale=w='min(iw,${options.maxWidth})':h=-2`,
      "-af",
      "asetpts=PTS-STARTPTS",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-map_metadata",
      "-1",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    options.signal,
  );
  if (!result.ok) return result;
  const proxy = await probeAsset(outputPath, { signal: options.signal });
  if (!proxy.ok) return proxy;
  const first = metadata.framePts[0];
  const map = proxy.value.framePts.map((_pts, i) => {
    const proxyTick = i * (240000 / options.fps),
      index = selectSourceFrame(metadata.framePts, first + proxyTick / 240000),
      sourcePts = metadata.framePts[Math.max(0, index)];
    return { proxyTick, sourceTick: sourceTickAt(sourcePts), sourcePts };
  });
  return ok({ path: outputPath, fps: { num: options.fps, den: 1 }, rotationApplied: true, map });
}
