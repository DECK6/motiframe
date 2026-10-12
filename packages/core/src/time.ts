import type { FrameRate } from "../../document/src/schema";
export const TICKS_PER_SECOND = 240000;
export function frameToTick(frame: number, fps: FrameRate): number {
  if (!Number.isSafeInteger(frame) || frame < 0 || ![24, 30, 60].includes(fps.num) || fps.den !== 1)
    throw new RangeError("Invalid frame or output FPS");
  const value = (frame * TICKS_PER_SECOND) / fps.num;
  if (!Number.isSafeInteger(value)) throw new RangeError("Tick overflow");
  return value;
}
export function frameCount(duration: number, fps: FrameRate): number {
  return Math.ceil(duration / frameToTick(1, fps));
}
export function timelineToLocal(instance: { start: number }, tick: number): number {
  return tick - instance.start;
}
