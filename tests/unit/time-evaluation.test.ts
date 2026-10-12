import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileProject } from "../../packages/core/src/compile";
import { evaluateCurve } from "../../packages/core/src/curves";
import { evaluateFrame } from "../../packages/core/src/evaluate";
import { frameCount, frameToTick } from "../../packages/core/src/time";
import type { FrameContext, Keyframe } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

const project = () => JSON.parse(readFileSync("tests/fixtures/mixed-static/project.json", "utf8"));
const at = (tick: number): FrameContext => ({
  tick,
  frame: Math.floor(tick / 8000),
  fps: { num: 30, den: 1 },
  seed: 7,
  frameToken: "same",
  documentRevision: 0,
});
const linear: Keyframe[] = [
  { id: "a", at: 0, value: 0, interpolation: "linear" },
  { id: "b", at: 240000, value: 100, interpolation: "hold" },
];
describe("deterministic time and curve evaluation", () => {
  it("maps exact frame and sample boundaries without accumulated floating error", () => {
    expect(frameToTick(45, { num: 30, den: 1 })).toBe(360000);
    expect(frameCount(1440000, { num: 30, den: 1 })).toBe(180);
    expect(frameToTick(180, { num: 30, den: 1 })).toBe(1440000);
  });
  it("interpolates and clamps values with literal independent expectations", () => {
    expect(expectOk(evaluateCurve(linear, 120000))).toBe(50);
    expect(expectOk(evaluateCurve(linear, 360000))).toBe(100);
    expect(expectOk(evaluateCurve([{ ...linear[0], interpolation: "hold" }, linear[1]], 120000))).toBe(0);
  });
  it("evaluates parametric cubic and supports overshoot between equal endpoint values", () => {
    const keys: Keyframe[] = [
      { id: "a", at: 0, value: 0, interpolation: "cubic", out: [1 / 3, 100] },
      { id: "b", at: 240000, value: 0, interpolation: "hold", in: [2 / 3, 100] },
    ];
    expect(expectOk(evaluateCurve(keys, 120000))).toBeCloseTo(75, 6);
  });
  it("preserves discrete values until their exact key tick", () => {
    const keys: Keyframe[] = [
      { id: "a", at: 0, value: "가", interpolation: "hold" },
      { id: "b", at: 240000, value: "나", interpolation: "hold" },
    ];
    expect(expectOk(evaluateCurve(keys, 239999))).toBe("가");
    expect(expectOk(evaluateCurve(keys, 240000))).toBe("나");
  });
  it("gives the same state for random seeks and excludes the end frame", () => {
    const doc = project();
    doc.channels["red:root:x"].keys = linear;
    const ir = expectOk(compileProject(doc));
    const first = expectOk(evaluateFrame(ir, at(360000)));
    evaluateFrame(ir, at(0));
    evaluateFrame(ir, at(120000));
    expect(expectOk(evaluateFrame(ir, at(360000)))).toEqual(first);
    expect(
      first.channelValues.find((c) => c.target.instanceId === "red" && c.target.channel === "x")?.value,
    ).toBe(100);
    expect(evaluateFrame(ir, at(1440000)).ok).toBe(false);
  });
  it.each(["cycle", "duplicate", "negative", "nan", "fps"] as const)(
    "rejects malformed %s projects before execution",
    (kind) => {
      const doc = project();
      if (kind === "cycle") {
        doc.instances.red.parentId = "blue";
        doc.instances.blue.parentId = "red";
      }
      if (kind === "duplicate") doc.tracks[1].instanceIds.push("red");
      if (kind === "negative") doc.instances.red.duration = -1;
      if (kind === "nan") doc.channels["red:root:x"].keys[0].value = NaN;
      if (kind === "fps") doc.settings.fps.num = 29.97;
      expect(compileProject(doc).ok).toBe(false);
    },
  );
});
