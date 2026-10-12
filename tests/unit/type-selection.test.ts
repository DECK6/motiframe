import { expect, it } from "vitest";
import { reconcileTextUnits, segmentText } from "../../packages/core/src/type/segment";
import { evaluateSelector } from "../../packages/core/src/type/selector";

it("preserves Unicode graphemes, text offsets and original normalization", () => {
  const text = "가가é👩‍💻";
  const units = segmentText(text, "grapheme");
  expect(units).toHaveLength(4);
  expect(units.map((u) => u.original).join("")).toBe(text);
  expect(units.map((u) => text.slice(u.start, u.end))).toEqual(units.map((u) => u.original));
  expect(segmentText("가👩‍💻", "grapheme")).toHaveLength(2);
  expect(
    segmentText("가 나\n다", "line")
      .map((u) => u.original)
      .join(""),
  ).toBe("가 나\n다");
});
it("keeps unchanged units stable across edits and identifies orphan unit IDs", () => {
  const before = segmentText("가나다", "grapheme");
  const changed = reconcileTextUnits(before, "가X다", "grapheme");
  expect(changed.units[0].id).toBe(before[0].id);
  expect(changed.units[2].id).toBe(before[2].id);
  expect(changed.orphanIds).toEqual([before[1].id]);
});
it("selects with deterministic stagger and restores original reading text", () => {
  const units = segmentText("가나다", "grapheme");
  const selector = { range: { start: 0, end: 240000 }, offset: 0, shape: "smooth" as const, stagger: 8000 };
  const start = evaluateSelector(units, selector, 0),
    end = evaluateSelector(units, selector, 256000);
  expect(start.map((u) => u.weight)).toEqual([0, 0, 0]);
  expect(end.map((u) => u.weight)).toEqual([1, 1, 1]);
  expect(end.map((u) => u.original).join("")).toBe("가나다");
  expect(evaluateSelector(units, selector, 120000)[0].weight).toBeCloseTo(0.5);
});
