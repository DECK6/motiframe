import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captureProject } from "../../apps/runner/src/capture";
import { openStage } from "../../apps/runner/src/stage-session";
import { compileProject } from "../../packages/core/src/compile";
import { evaluateFrame } from "../../packages/core/src/evaluate";
import type { FrameContext } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

const project = () => JSON.parse(readFileSync("tests/fixtures/mixed-static/project.json", "utf8"));
const context = (tick: number, token = "test"): FrameContext => ({
  tick,
  frame: Math.floor(tick / 8000),
  fps: { num: 30, den: 1 },
  seed: 7,
  frameToken: token,
  documentRevision: 0,
});
describe("frame ownership and readiness", () => {
  it("composes an HTML child inside a React host slot and respects parent clipping", async () => {
    const doc = project();
    doc.definitions.red.moduleHash = "builtin:react-group";
    doc.definitions.red.slots = [{ id: "children" }];
    doc.definitions.red.targets[0].channels.push("clipProgress");
    doc.instances.red.props = { width: 200, height: 150 };
    doc.instances.blue.parentId = "red";
    doc.instances.blue.slotId = "children";
    doc.scenes.main.rootIds = ["red"];
    doc.channels.crop = {
      target: { instanceId: "red", targetKey: "root", channel: "clipProgress" },
      owner: "manual",
      locked: false,
      keys: [{ id: "crop", at: 0, value: 0.5, interpolation: "hold" }],
    };
    const frame = expectOk(await captureProject(doc, { tick: 0 }));
    expect(frame.receipt.targetBounds["blue/root"].x).toBe(125);
    const { PNG } = await import("pngjs");
    const png = PNG.sync.read(Buffer.from(frame.png));
    const rgba = (x: number, y: number) => [
      ...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4),
    ];
    expect(rgba(130, 140)).toEqual([0, 0, 255, 255]);
    expect(rgba(160, 140)).toEqual([0, 0, 0, 255]);
  });
  it("captures evaluated motion at arbitrary times", async () => {
    const doc = project();
    doc.channels["red:root:x"].keys = [
      { id: "red-x", at: 0, value: 0, interpolation: "linear" },
      { id: "red-x2", at: 240000, value: 100, interpolation: "hold" },
    ];
    const frame = expectOk(await captureProject(doc, { tick: 120000 }));
    expect(frame.receipt.targetBounds["red/root"].x).toBe(50);
  });
  it("applies per-frame props without changing stable target motion on React reorder", async () => {
    const doc = project();
    doc.definitions.red.moduleHash = "builtin:react-words";
    doc.definitions.red.targets.push(
      { key: "item-a", channels: ["x"], coordinateSpace: "local" },
      { key: "item-b", channels: ["x"], coordinateSpace: "local" },
    );
    doc.instances.red.props = { words: ["a", "b"] };
    doc.channels = {
      b: {
        target: { instanceId: "red", targetKey: "item-b", channel: "x" },
        owner: "manual",
        locked: false,
        keys: [{ id: "b-x", at: 0, value: 120, interpolation: "hold" }],
      },
    };
    const stage = await openStage(320, 180);
    try {
      const loaded = await stage.page.evaluate(async (doc) => {
        try {
          return await window.motiframe.load(doc);
        } catch (error) {
          return { ok: false, error: { message: String(error) } };
        }
      }, doc);
      expect(loaded.ok).toBe(true);
      const ir = expectOk(compileProject(doc));
      const first = expectOk(evaluateFrame(ir, context(0)));
      const initial = await stage.page.evaluate((plan) => window.motiframe.renderFrame(plan), first);
      expect(expectOk(initial).targetBounds["red/item-b"].x).toBe(120);
      const next = structuredClone(first);
      next.frameToken = "reordered";
      next.instances.find((i) => i.id === "red")!.props.words = ["b", "a"];
      const receipt = expectOk(await stage.page.evaluate((plan) => window.motiframe.renderFrame(plan), next));
      expect(receipt.targetBounds["red/item-b"].x).toBe(120);
    } finally {
      await stage.close();
    }
  });
  it("rejects superseded frame requests instead of returning an old commit as ready", async () => {
    const doc = project();
    const ir = expectOk(compileProject(doc));
    const stage = await openStage(320, 180);
    try {
      await stage.page.evaluate((doc) => window.motiframe.load(doc), doc);
      const a = expectOk(evaluateFrame(ir, context(0, "old-frame"))),
        b = expectOk(evaluateFrame(ir, context(8000, "new-frame")));
      const results = await stage.page.evaluate(
        async (plans) =>
          Promise.all([window.motiframe.renderFrame(plans[0]), window.motiframe.renderFrame(plans[1])]),
        [a, b],
      );
      expect(results[0].ok).toBe(false);
      expect(expectOk(results[1]).frameToken).toBe("new-frame");
    } finally {
      await stage.close();
    }
  });
});
