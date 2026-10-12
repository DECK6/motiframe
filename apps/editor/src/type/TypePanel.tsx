import { useEffect, useState } from "react";
import { compileProject } from "../../../../packages/core/src/compile";
import {
  reconcileTextUnits,
  segmentText,
  type TextUnit,
  type TextUnitKind,
} from "../../../../packages/core/src/type/segment";
import { evaluateSelector, type TextSelector } from "../../../../packages/core/src/type/selector";
import type { Instance, JsonValue } from "../../../../packages/document/src/schema";
import type { PanelProps } from "../types";

const savedUnits = (value: JsonValue | undefined): TextUnit[] =>
  Array.isArray(value)
    ? value.filter(
        (u): u is TextUnit =>
          u !== null &&
          typeof u === "object" &&
          !Array.isArray(u) &&
          typeof u.id === "string" &&
          typeof u.original === "string" &&
          typeof u.start === "number" &&
          typeof u.end === "number",
      )
    : [];
export function typePropsForText(
  props: Instance["props"],
  text: string,
  unit: TextUnitKind,
): Instance["props"] {
  const previous = savedUnits(props.textUnits),
    next = previous.length
      ? reconcileTextUnits(previous, text, unit)
      : { units: segmentText(text, unit), orphanIds: [] };
  return { ...props, text, textUnit: unit, textUnits: next.units, orphanTextUnitIds: next.orphanIds };
}
function selectorFrom(props: Instance["props"]): TextSelector {
  const value = props.textSelector;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const r = value.range;
    if (
      r &&
      typeof r === "object" &&
      !Array.isArray(r) &&
      typeof r.start === "number" &&
      typeof r.end === "number" &&
      r.end > r.start
    )
      return {
        range: { start: r.start, end: r.end },
        offset: typeof value.offset === "number" ? value.offset : 0,
        shape: value.shape === "linear" ? "linear" : "smooth",
        stagger: typeof value.stagger === "number" ? value.stagger : 8000,
      };
  }
  return { range: { start: 0, end: 240000 }, offset: 0, shape: "smooth", stagger: 8000 };
}
export default function TypePanel({ document, selection, tick, submit, notify }: PanelProps) {
  const id = selection[0],
    instance = document.instances[id],
    original = typeof instance?.props.text === "string" ? instance.props.text : "",
    unit = (
      ["grapheme", "word", "line"].includes(String(instance?.props.textUnit))
        ? instance.props.textUnit
        : "grapheme"
    ) as TextUnitKind;
  const [draft, setDraft] = useState(original);
  useEffect(() => setDraft(original), [original, id]);
  if (!instance)
    return (
      <div className="panel-stack">
        <p className="muted">Select a layer to edit its typography.</p>
      </div>
    );
  const stored = savedUnits(instance.props.textUnits),
    units = stored.length ? stored : segmentText(original, unit),
    selector = selectorFrom(instance.props),
    compiled = compileProject(document),
    localTick = tick - (compiled.ok ? compiled.value.starts[id] : instance.start),
    selected = evaluateSelector(units, selector, localTick),
    orphanIds = instance.props.orphanTextUnitIds;
  const saveText = (text = draft, nextUnit = unit) =>
    void submit([
      { type: "SetProps", instanceId: id, props: typePropsForText(instance.props, text, nextUnit) },
    ]);
  const saveSelector = (next: TextSelector) => {
    if (
      !Number.isSafeInteger(next.range.start) ||
      !Number.isSafeInteger(next.range.end) ||
      next.range.start < 0 ||
      next.range.end <= next.range.start ||
      next.range.end > instance.duration ||
      next.stagger < 0
    ) {
      notify("The selector must end after its start, within the layer duration.");
      return;
    }
    void submit([
      { type: "SetProps", instanceId: id, props: { textSelector: next, textUnits: units, textUnit: unit } },
    ]);
  };
  const readStart = Math.min(
      instance.duration,
      selector.range.end + selector.offset + Math.max(0, units.length - 1) * selector.stagger,
    ),
    globalStart = compiled.ok ? compiled.value.starts[id] : instance.start;
  return (
    <div className="panel-stack">
      <label htmlFor="type-original">
        <strong>Source text</strong>
      </label>
      <textarea
        id="type-original"
        rows={4}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Text to animate"
        style={{ width: "100%", resize: "vertical" }}
      />
      <div className="field-row">
        <button className="primary" type="button" onClick={() => saveText()}>
          Apply text
        </button>
        <label htmlFor="type-unit">Unit</label>
        <select id="type-unit" value={unit} onChange={(e) => saveText(draft, e.target.value as TextUnitKind)}>
          <option value="grapheme">Grapheme</option>
          <option value="word">Word</option>
          <option value="line">Explicit newlines</option>
        </select>
      </div>
      <p className="muted">
        Preserves Hangul, combining characters, and emoji. Line units use only explicit newlines in the source
        text.
      </p>
      <div
        className="card"
        aria-label="Typography selector preview"
        style={{ whiteSpace: "pre-wrap", minHeight: 76, fontSize: 24, lineHeight: 1.6 }}
      >
        {selected.length ? (
          selected.map((u) => (
            <span
              key={u.id}
              title={`${u.id} · ${Math.round(u.weight * 100)}%`}
              style={{
                display: "inline-block",
                opacity: 0.2 + 0.8 * u.weight,
                transform: `translateY(${(1 - u.weight) * 10}px)`,
                borderBottom: "1px solid rgba(166,224,199,.3)",
              }}
            >
              {u.original}
            </span>
          ))
        ) : (
          <span className="muted">Enter text to preview.</span>
        )}
      </div>
      <div className="field-row">
        <span className="badge">{units.length} units</span>
        <span className="muted">Local time {(localTick / 240000).toFixed(2)}s</span>
      </div>
      <div className="field-row">
        <label>
          Start (s)
          <input
            aria-label="Typography start"
            type="number"
            min="0"
            step=".05"
            value={selector.range.start / 240000}
            onChange={(e) =>
              saveSelector({
                ...selector,
                range: { ...selector.range, start: Math.round(Number(e.target.value) * 240000) },
              })
            }
          />
        </label>
        <label>
          End (s)
          <input
            aria-label="Typography end"
            type="number"
            min="0"
            step=".05"
            value={selector.range.end / 240000}
            onChange={(e) =>
              saveSelector({
                ...selector,
                range: { ...selector.range, end: Math.round(Number(e.target.value) * 240000) },
              })
            }
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          Stagger (ms)
          <input
            aria-label="Unit stagger"
            type="number"
            min="0"
            step="5"
            value={selector.stagger / 240}
            onChange={(e) => saveSelector({ ...selector, stagger: Math.round(Number(e.target.value) * 240) })}
          />
        </label>
        <label>
          Offset (ms)
          <input
            aria-label="Selector offset"
            type="number"
            step="5"
            value={selector.offset / 240}
            onChange={(e) => saveSelector({ ...selector, offset: Math.round(Number(e.target.value) * 240) })}
          />
        </label>
      </div>
      <div className="field-row">
        <label htmlFor="type-shape">Selector shape</label>
        <select
          id="type-shape"
          value={selector.shape}
          onChange={(e) => saveSelector({ ...selector, shape: e.target.value as TextSelector["shape"] })}
        >
          <option value="smooth">Smooth</option>
          <option value="linear">Linear</option>
        </select>
      </div>
      <button
        type="button"
        disabled={readStart >= instance.duration}
        onClick={() =>
          void submit([
            {
              type: "UpdateScore",
              score: {
                windows: [
                  ...document.score.windows,
                  {
                    id: `reading:${id}:${document.revision}`,
                    range: { start: globalStart + readStart, end: globalStart + instance.duration },
                    targetIds: [id],
                    role: "reading",
                  },
                ],
              },
            },
          ])
        }
      >
        Mark reading window after reveal
      </button>
      {Array.isArray(orphanIds) && orphanIds.length > 0 && (
        <p role="status" className="muted">
          {orphanIds.length} units were removed by the text edit. Review their linked motion.
        </p>
      )}
    </div>
  );
}
