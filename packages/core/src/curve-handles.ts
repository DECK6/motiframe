import { fail, ok, type Result } from "../../document/src/result";
import type { Keyframe } from "../../document/src/schema";
export function setEndpointVelocity(
  keys: Keyframe[],
  keyId: string,
  side: "in" | "out",
  velocity: number,
  influence: number,
): Result<Keyframe[]> {
  if (!Number.isFinite(velocity) || !Number.isFinite(influence) || influence <= 0 || influence > 1)
    return fail("INVALID_HANDLE", "Velocity must be finite and influence in (0, 1]");
  const sorted = structuredClone(keys).sort((a, b) => a.at - b.at);
  const index = sorted.findIndex((k) => k.id === keyId);
  const a = sorted[side === "out" ? index : index - 1],
    b = sorted[side === "out" ? index + 1 : index];
  if (index < 0 || !a || !b || b.at <= a.at || typeof a.value !== "number" || typeof b.value !== "number")
    return fail("INVALID_SEGMENT", "A numeric segment with positive duration is required", [keyId]);
  const seconds = (b.at - a.at) / 240000;
  const out = a.out ?? [1 / 3, a.value + (b.value - a.value) / 3];
  const incoming = b.in ?? [2 / 3, a.value + (2 * (b.value - a.value)) / 3];
  if (side === "out") {
    if (influence > incoming[0]) return fail("INVALID_HANDLE", "Time handles would cross");
    a.out = [influence, a.value + velocity * seconds * influence];
    b.in = incoming;
  } else {
    if (1 - influence < out[0]) return fail("INVALID_HANDLE", "Time handles would cross");
    b.in = [1 - influence, b.value - velocity * seconds * influence];
    a.out = out;
  }
  if (!a.out?.every(Number.isFinite) || !b.in?.every(Number.isFinite))
    return fail("INVALID_HANDLE", "Control point calculation overflowed");
  a.interpolation = "cubic";
  return ok(sorted);
}
