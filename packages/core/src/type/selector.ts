import type { TextUnit } from "./segment";
export type TextSelector = {
  range: { start: number; end: number };
  offset: number;
  shape: "linear" | "smooth";
  stagger: number;
};
export type SelectedUnit = TextUnit & { weight: number; selected: boolean };
export function evaluateSelector(units: TextUnit[], selector: TextSelector, tick: number): SelectedUnit[] {
  const { start, end } = selector.range;
  const valid =
    [start, end, selector.offset, selector.stagger, tick].every(Number.isFinite) &&
    end > start &&
    selector.stagger >= 0;
  return units.map((unit, index) => {
    const progress = valid
      ? Math.max(0, Math.min(1, (tick - start - selector.offset - index * selector.stagger) / (end - start)))
      : 0;
    const weight = selector.shape === "smooth" ? progress * progress * (3 - 2 * progress) : progress;
    return { ...unit, weight, selected: weight > 0 };
  });
}
