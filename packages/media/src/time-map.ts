import { fail, ok, type Result } from "../../document/src/result";
export type MediaClip = {
  assetId: string;
  sourceIn: number;
  sourceOut: number;
  rate: { num: number; den: number };
  gain: number;
};
export const isTick = (value: number) => Number.isSafeInteger(value) && value >= 0;
export function getSourceTick(clip: MediaClip & { start: number }, timelineTick: number): Result<number> {
  if (
    ![clip.start, clip.sourceIn, clip.sourceOut, timelineTick].every(isTick) ||
    !Number.isSafeInteger(clip.rate?.num) ||
    !Number.isSafeInteger(clip.rate?.den) ||
    clip.rate.num <= 0 ||
    clip.rate.den <= 0 ||
    clip.sourceOut <= clip.sourceIn
  )
    return fail("INVALID_MEDIA_TIME", "Media ranges and positive rational rates must be safe integers", [
      clip.assetId,
    ]);
  if (timelineTick < clip.start)
    return fail("SOURCE_OUT_OF_RANGE", "Timeline precedes the clip", [clip.assetId]);
  const numerator = BigInt(timelineTick - clip.start) * BigInt(clip.rate.num);
  const denominator = BigInt(clip.rate.den);
  if (numerator % denominator !== 0n)
    return fail("INEXACT_SOURCE_TICK", "Source time cannot be represented as an integer tick", [
      clip.assetId,
    ]);
  const source = BigInt(clip.sourceIn) + numerator / denominator;
  if (source >= BigInt(clip.sourceOut))
    return fail("SOURCE_OUT_OF_RANGE", "Source end is exclusive", [clip.assetId]);
  return ok(Number(source));
}
