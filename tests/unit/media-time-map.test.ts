import { describe, expect, it } from "vitest";
import { getSourceTick } from "../../packages/media/src/time-map";
import { expectOk } from "../helpers/result";

const clip = {
  assetId: "video",
  start: 240000,
  sourceIn: 480000,
  sourceOut: 960000,
  rate: { num: 3, den: 2 },
  gain: 1,
};
describe("media source time", () => {
  it("maps local timeline time using source in and exact rational rate", () => {
    expect(expectOk(getSourceTick(clip, 400000))).toBe(720000);
    expect(expectOk(getSourceTick({ ...clip, start: 1000000 }, 1160000))).toBe(720000);
  });
  it("rejects a fractional source tick rather than rounding", () => {
    expect(getSourceTick(clip, 240001)).toMatchObject({ ok: false, error: { code: "INEXACT_SOURCE_TICK" } });
  });
  it("uses end-exclusive source ranges and rejects invalid time or rate", () => {
    expect(getSourceTick(clip, 560000)).toMatchObject({ ok: false, error: { code: "SOURCE_OUT_OF_RANGE" } });
    expect(getSourceTick(clip, 239999).ok).toBe(false);
    expect(getSourceTick({ ...clip, rate: { num: 0, den: 1 } }, 240000).ok).toBe(false);
    expect(getSourceTick(clip, NaN).ok).toBe(false);
  });
});
