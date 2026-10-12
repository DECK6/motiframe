import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateCurve } from "../../packages/core/src/curves";
import { applyTransaction } from "../../packages/document/src/apply";
import type { EditCommand, EditTransaction } from "../../packages/document/src/commands";
import type { ProjectDocument } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

const fixture = (): ProjectDocument =>
  JSON.parse(readFileSync("tests/fixtures/mixed-static/project.json", "utf8"));
const edit = (d: ProjectDocument, commands: EditCommand[], ripple = false): EditTransaction => ({
  id: "clips",
  baseRevision: d.revision,
  author: "user",
  scope: {
    instanceIds: [...Object.keys(d.instances), "right", "copy"],
    range: { start: 0, end: d.settings.duration },
    preserveDuration: true,
    ripple,
  },
  commands,
});
describe("clip edits preserve source and animation", () => {
  it("splits cubic curves exactly and preserves media source time", () => {
    const d = fixture();
    d.mediaClips.red = {
      assetId: "video",
      sourceIn: 480000,
      sourceOut: 1920000,
      rate: { num: 1, den: 1 },
      gain: 1,
    };
    d.channels["red:root:x"].keys = [
      { id: "a", at: 0, value: 0, interpolation: "cubic", out: [0.2, 150] },
      { id: "b", at: 1440000, value: 0, interpolation: "hold", in: [0.7, 100] },
    ];
    const out = expectOk(
      applyTransaction(
        d,
        edit(d, [{ type: "SplitClip", instanceId: "red", at: 720000, newInstanceId: "right" }]),
      ),
    ).document;
    expect(out.instances.red.duration).toBe(720000);
    expect(out.instances.right.start).toBe(720000);
    expect(out.mediaClips.right).toMatchObject({ sourceIn: 1200000 });
    const right = Object.values(out.channels).find(
      (c) => c.target.instanceId === "right" && c.target.channel === "x",
    )!;
    for (const tick of [0, 12000, 359999, 720000, 720001, 1000000, 1439999]) {
      const actual = tick < 720000 ? out.channels["red:root:x"] : right;
      expect(expectOk(evaluateCurve(actual.keys, tick < 720000 ? tick : tick - 720000))).toBeCloseTo(
        expectOk(evaluateCurve(d.channels["red:root:x"].keys, tick)) as number,
        6,
      );
    }
  });
  it("trims without ripple, shifts local curve and source offset", () => {
    const d = fixture();
    d.mediaClips.red = {
      assetId: "video",
      sourceIn: 480000,
      sourceOut: 1920000,
      rate: { num: 1, den: 1 },
      gain: 1,
    };
    d.channels["red:root:x"].keys = [
      { id: "a", at: 0, value: 0, interpolation: "linear" },
      { id: "b", at: 1440000, value: 100, interpolation: "hold" },
    ];
    const out = expectOk(
      applyTransaction(
        d,
        edit(d, [{ type: "TrimClip", instanceId: "red", start: 240000, duration: 720000 }]),
      ),
    ).document;
    expect(out.instances.blue.start).toBe(0);
    expect(out.mediaClips.red).toMatchObject({ sourceIn: 720000, sourceOut: 1440000 });
    expect(expectOk(evaluateCurve(out.channels["red:root:x"].keys, 0))).toBeCloseTo(100 / 6);
  });
  it("duplicates stable IDs and removes related channels atomically", () => {
    const d = fixture();
    const copy = expectOk(
      applyTransaction(d, edit(d, [{ type: "DuplicateInstance", instanceId: "red", newInstanceId: "copy" }])),
    ).document;
    expect(copy.instances.copy).toEqual(d.instances.red);
    expect(new Set(Object.values(copy.channels).flatMap((c) => c.keys.map((k) => k.id))).size).toBe(6);
    const removed = expectOk(
      applyTransaction(copy, edit(copy, [{ type: "RemoveInstance", instanceId: "copy" }])),
    ).document;
    expect(removed.instances.copy).toBeUndefined();
    expect(Object.values(removed.channels).some((c) => c.target.instanceId === "copy")).toBe(false);
  });
});
