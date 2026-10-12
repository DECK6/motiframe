import { describe, expect, it } from "vitest";
import {
  type FrameCacheInput,
  getFrameCacheKey,
  invalidateChanges,
  LruFrameCache,
} from "../../packages/core/src/cache";
import type { ProjectDocument } from "../../packages/document/src/schema";
import fixture from "../fixtures/mixed-static/project.json";

const input: FrameCacheInput = {
  projectId: "project",
  documentHash: "doc-a",
  documentRevision: 1,
  definitionRevisions: { element: 1 },
  sourceHashes: { element: "source-a" },
  assetHashes: { video: "video-a" },
  fontHashes: { font: "font-a" },
  runtimeHash: "runtime-a",
  width: 1280,
  height: 720,
  seed: 7,
  tick: 0,
};
describe("frame cache", () => {
  it("keys every render dependency and ignores record insertion order", () => {
    const key = getFrameCacheKey(input);
    for (const patch of [
      { documentHash: "doc-b" },
      { documentRevision: 2 },
      { definitionRevisions: { element: 2 } },
      { sourceHashes: { element: "source-b" } },
      { assetHashes: { video: "video-b" } },
      { fontHashes: { font: "font-b" } },
      { runtimeHash: "runtime-b" },
      { width: 640 },
      { height: 360 },
      { seed: 8 },
      { tick: 8000 },
    ])
      expect(getFrameCacheKey({ ...input, ...patch })).not.toBe(key);
    expect(getFrameCacheKey({ ...input, assetHashes: { a: "1", b: "2" } })).toBe(
      getFrameCacheKey({ ...input, assetHashes: { b: "2", a: "1" } }),
    );
  });
  it("evicts least recently used entries by byte and entry budgets", () => {
    const cache = new LruFrameCache<string>({ maxEntries: 2, maxBytes: 10 });
    cache.set(input, "first", 4);
    cache.set({ ...input, tick: 8000 }, "second", 4);
    expect(cache.get(input)).toBe("first");
    cache.set({ ...input, tick: 16000 }, "third", 4);
    expect(cache.get({ ...input, tick: 8000 })).toBeUndefined();
    expect(cache.get(input)).toBe("first");
    expect(cache.stats).toMatchObject({ entries: 2, bytes: 8 });
    cache.set({ ...input, tick: 24000 }, "oversized", 11);
    expect(cache.get({ ...input, tick: 24000 })).toBeUndefined();
    expect(cache.stats.bytes).toBeLessThanOrEqual(10);
  });
  it("invalidates dependency changes while retaining and rekeying unrelated time ranges", () => {
    const before = structuredClone(fixture) as ProjectDocument;
    before.settings.duration = 480000;
    before.instances.red.start = 0;
    before.instances.red.duration = 240000;
    const after = structuredClone(before);
    after.revision++;
    after.instances.red.props.text = "changed";
    const changes = invalidateChanges(before, after);
    expect(changes.ranges).toEqual([{ start: 0, end: 240000 }]);
    const cache = new LruFrameCache<string>();
    cache.set({ ...input, tick: 8000 }, "affected", 1);
    cache.set({ ...input, tick: 320000 }, "unaffected", 1);
    const next = { ...input, documentHash: "doc-b", documentRevision: 2 };
    cache.rebase(input, next, changes);
    expect(cache.get({ ...next, tick: 8000 })).toBeUndefined();
    expect(cache.get({ ...next, tick: 320000 })).toBe("unaffected");
  });
  it("invalidates clip source, definition source, font, seed and resolution changes", () => {
    const before = structuredClone(fixture) as ProjectDocument;
    const font = structuredClone(before);
    font.assets.font = { kind: "font", sha256: "font-b", logicalPath: "font.ttf" };
    expect(invalidateChanges(before, font).all).toBe(true);
    for (const settings of [{ seed: 99 }, { width: 720 }]) {
      const after = structuredClone(before);
      Object.assign(after.settings, settings);
      expect(invalidateChanges(before, after).all).toBe(true);
    }
    const source = structuredClone(before);
    const id = before.instances.red.definitionId;
    source.definitions[id].moduleHash = "source-b";
    expect(invalidateChanges(before, source).definitionIds).toContain(id);
    expect(invalidateChanges(before, source).instanceIds).toContain("red");
    const clip = structuredClone(before);
    clip.mediaClips.red = {
      assetId: "video",
      sourceIn: 100,
      sourceOut: 1000,
      rate: { num: 1, den: 1 },
      gain: 1,
    };
    expect(invalidateChanges(before, clip).instanceIds).toContain("red");
  });
});

it("does not rebase frames across a runtime, font or render geometry change", () => {
  for (const patch of [
    { runtimeHash: "runtime-b" },
    { fontHashes: { font: "font-b" } },
    { width: 640 },
    { height: 360 },
    { seed: 99 },
  ]) {
    const cache = new LruFrameCache<string>();
    cache.set(input, "old", 1);
    const next = { ...input, ...patch, documentRevision: 2, documentHash: "doc-b" };
    cache.rebase(input, next, {
      all: false,
      ranges: [],
      instanceIds: [],
      assetIds: [],
      fontIds: [],
      definitionIds: [],
    });
    expect(cache.get(next)).toBeUndefined();
  }
});

it("measures cold and warm real frame evaluations with explicit environment metadata", async () => {
  const { benchmarkFrameWorkload } = await import("../../packages/core/src/cache");
  const { compileProject } = await import("../../packages/core/src/compile");
  const { evaluateFrame } = await import("../../packages/core/src/evaluate");
  const { expectOk } = await import("../helpers/result");
  const ir = expectOk(compileProject(fixture));
  const report = await benchmarkFrameWorkload(
    [0, 8000, 16000],
    async (tick) =>
      evaluateFrame(ir, {
        tick,
        frame: tick / 8000,
        fps: { num: 30, den: 1 },
        seed: 7,
        frameToken: `benchmark:${tick}`,
        documentRevision: ir.documentRevision,
      }),
    {
      operation: "evaluateFrame",
      runtime: process.version,
      os: process.platform,
      width: 320,
      height: 180,
      power: "unknown",
    },
  );
  expect(report.samples).toBe(3);
  expect(report.environment.operation).toBe("evaluateFrame");
  for (const phase of [report.cold, report.warm]) {
    expect(phase.durationsMs).toHaveLength(3);
    expect(phase.failedFrames).toBe(0);
    expect(phase.p95Ms).toBeGreaterThanOrEqual(phase.p50Ms);
    expect(phase.p50Ms).toBeGreaterThanOrEqual(0);
  }
});
