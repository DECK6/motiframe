import { evaluateCurve } from "../../core/src/curves";
import { fail, ok, type Result } from "./result";
import type { JsonValue, Keyframe } from "./schema";

type Point = [number, number];
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/** De Casteljau subdivision keeps the same parametric curve, including overshoot. */
export function splitCurve(
  keys: Keyframe[],
  at: number,
  idPrefix: string,
): Result<{ left: Keyframe[]; right: Keyframe[] }> {
  const sorted = structuredClone(keys).sort((a, b) => a.at - b.at);
  const value = evaluateCurve(sorted, at);
  if (!value.ok) return value;
  const exact = sorted.find((k) => k.at === at);
  let left = sorted.filter((k) => k.at < at),
    right = sorted.filter((k) => k.at > at);
  if (exact) {
    left.push({ ...exact });
    right.unshift({ ...exact });
  } else {
    const a = left.at(-1),
      b = right[0];
    const boundary: Keyframe = {
      id: `${idPrefix}:boundary`,
      at,
      value: value.value,
      interpolation: a?.interpolation ?? "hold",
    };
    if (a && b && a.interpolation === "cubic" && typeof a.value === "number" && typeof b.value === "number") {
      const out = a.out ?? [1 / 3, a.value + (b.value - a.value) / 3],
        incoming = b.in ?? [2 / 3, a.value + (2 * (b.value - a.value)) / 3];
      const points: Point[] = [
        [a.at, a.value],
        [a.at + out[0] * (b.at - a.at), out[1]],
        [a.at + incoming[0] * (b.at - a.at), incoming[1]],
        [b.at, b.value],
      ];
      let low = 0,
        high = 1;
      for (let n = 0; n < 56; n++) {
        const u = (low + high) / 2;
        const p = lerp(points[0], points[1], u),
          q = lerp(points[1], points[2], u),
          r = lerp(points[2], points[3], u);
        if (lerp(lerp(p, q, u), lerp(q, r, u), u)[0] < at) low = u;
        else high = u;
      }
      const u = (low + high) / 2,
        p = lerp(points[0], points[1], u),
        q = lerp(points[1], points[2], u),
        r = lerp(points[2], points[3], u),
        s = lerp(p, q, u),
        t = lerp(q, r, u);
      a.out = [(p[0] - a.at) / (at - a.at), p[1]];
      boundary.in = [(s[0] - a.at) / (at - a.at), s[1]];
      boundary.out = [(t[0] - at) / (b.at - at), t[1]];
      b.in = [(r[0] - at) / (b.at - at), r[1]];
    }
    left.push({ ...boundary });
    right.unshift({ ...boundary });
  }
  left = left.map((k) => ({ ...k }));
  right = right.map((k) => ({ ...k, id: `${idPrefix}:${k.id}`, at: k.at - at }));
  return ok({ left, right });
}
export function sliceCurve(
  keys: Keyframe[],
  start: number,
  end: number,
  idPrefix: string,
): Result<Keyframe[]> {
  if (start < 0 || end <= start) return fail("INVALID_TRIM", "Trim must retain positive duration");
  const endSplit = splitCurve(keys, end, `${idPrefix}:end`);
  if (!endSplit.ok) return endSplit;
  const startSplit = splitCurve(endSplit.value.left, start, `${idPrefix}:start`);
  if (!startSplit.ok) return startSplit;
  return ok(startSplit.value.right);
}
export type MediaClip = {
  assetId: string;
  sourceIn: number;
  sourceOut: number;
  rate: { num: number; den: number };
  gain: number;
  [key: string]: JsonValue;
};
export function trimMedia(clip: JsonValue, start: number, duration: number): Result<JsonValue> {
  if (!clip || typeof clip !== "object" || Array.isArray(clip))
    return fail("INVALID_MEDIA", "Expected media clip");
  const c = clip as MediaClip;
  const delta = (start * c.rate?.num) / c.rate?.den;
  const length = (duration * c.rate?.num) / c.rate?.den;
  if (
    !Number.isSafeInteger(delta) ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    !Number.isSafeInteger(c.sourceIn)
  )
    return fail("INVALID_MEDIA", "Media source mapping must use exact nonnegative ticks");
  const sourceIn = c.sourceIn + delta,
    sourceOut = sourceIn + length;
  if (sourceIn < c.sourceIn || sourceOut > c.sourceOut)
    return fail("MEDIA_RANGE", "Trim exceeds available source range");
  return ok({ ...c, sourceIn, sourceOut });
}
