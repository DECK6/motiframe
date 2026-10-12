import { expect, it } from "vitest";
import { setEndpointVelocity } from "../../packages/core/src/curve-handles";
import { evaluateCurve } from "../../packages/core/src/curves";
import type { Keyframe } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

it("sets physical velocity without moving endpoints including equal endpoint values", () => {
  for (const value of [100, 0, -100]) {
    const keys: Keyframe[] = [
      { id: "a", at: 0, value: 0, interpolation: "linear" },
      { id: "b", at: 240000, value, interpolation: "hold" },
    ];
    const updated = expectOk(setEndpointVelocity(keys, "a", "out", 200, 0.25));
    expect(expectOk(evaluateCurve(updated, 0))).toBe(0);
    expect(expectOk(evaluateCurve(updated, 240000))).toBe(value);
    expect((expectOk(evaluateCurve(updated, 1)) as number) * 240000).toBeCloseTo(200, 1);
    expect(keys[0].interpolation).toBe("linear");
  }
});
it("rejects nonfinite handles, zero duration and crossing time controls", () => {
  const keys: Keyframe[] = [
    { id: "a", at: 0, value: 0, interpolation: "cubic" },
    { id: "b", at: 240000, value: 100, interpolation: "hold", in: [0.4, 100] },
  ];
  expect(setEndpointVelocity(keys, "a", "out", NaN, 0.2).ok).toBe(false);
  expect(setEndpointVelocity(keys, "a", "out", 10, 0.7).ok).toBe(false);
  expect(setEndpointVelocity([{ ...keys[0] }, { ...keys[1], at: 0 }], "a", "out", 10, 0.2).ok).toBe(false);
});
it("sets incoming physical velocity and rejects overflow without mutating input", () => {
  const keys: Keyframe[] = [
    { id: "a", at: 0, value: 0, interpolation: "linear" },
    { id: "b", at: 240000, value: -100, interpolation: "hold" },
  ];
  const changed = expectOk(setEndpointVelocity(keys, "b", "in", -200, 0.25));
  expect((-100 - (expectOk(evaluateCurve(changed, 239999)) as number)) * 240000).toBeCloseTo(-200, 1);
  expect(
    setEndpointVelocity([{ ...keys[0], value: Number.MAX_VALUE }, keys[1]], "a", "out", Number.MAX_VALUE, 0.5)
      .ok,
  ).toBe(false);
});
