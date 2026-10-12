import { fail, ok, type Result } from "../../document/src/result";
import type { JsonValue, Keyframe } from "../../document/src/schema";

function bezier(a: number, b: number, c: number, d: number, t: number) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}
export function evaluateCurve(keys: Keyframe[], tick: number): Result<JsonValue> {
  if (!keys.length || !Number.isFinite(tick))
    return fail("INVALID_CURVE", "A curve needs keys and finite time");
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  for (let i = 0; i < sorted.length; i++) {
    const k = sorted[i];
    if (
      !Number.isSafeInteger(k.at) ||
      k.at < 0 ||
      (i > 0 && k.at === sorted[i - 1].at) ||
      (typeof k.value === "number" && !Number.isFinite(k.value))
    )
      return fail("INVALID_CURVE", "Invalid or duplicate key time/value", [k.id]);
  }
  if (tick <= sorted[0].at) return ok(sorted[0].value);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i],
      b = sorted[i + 1];
    if (tick >= b.at) continue;
    if (a.interpolation === "hold") return ok(a.value);
    if (typeof a.value !== "number" || typeof b.value !== "number")
      return fail("DISCRETE_INTERPOLATION", "Discrete values support hold interpolation only");
    const t = (tick - a.at) / (b.at - a.at);
    if (a.interpolation === "linear") return ok(a.value + (b.value - a.value) * t);
    const out = a.out ?? [1 / 3, a.value + (b.value - a.value) / 3],
      incoming = b.in ?? [2 / 3, a.value + (2 * (b.value - a.value)) / 3];
    if (
      out[0] < 0 ||
      incoming[0] > 1 ||
      out[0] > incoming[0] ||
      !out.every(Number.isFinite) ||
      !incoming.every(Number.isFinite)
    )
      return fail("INVALID_CURVE", "Cubic time handles must be monotonic and finite");
    let low = 0,
      high = 1;
    for (let n = 0; n < 48; n++) {
      const mid = (low + high) / 2;
      if (bezier(0, out[0], incoming[0], 1, mid) < t) low = mid;
      else high = mid;
    }
    return ok(bezier(a.value, out[1], incoming[1], b.value, (low + high) / 2));
  }
  return ok(sorted[sorted.length - 1].value);
}
