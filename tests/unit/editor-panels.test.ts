import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import CurveEditor, { makeDraggedKey, sampleCurveGraph } from "../../apps/editor/src/curves/CurveEditor";
import ScorePanel, {
  commandsForEventChange,
  recipeOwnershipCommands,
} from "../../apps/editor/src/score/ScorePanel";
import TypePanel, { typePropsForText } from "../../apps/editor/src/type/TypePanel";
import type { PanelProps } from "../../apps/editor/src/types";
import { ok } from "../../packages/document/src/result";
import type { Keyframe, ProjectDocument } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

const fixture = (): ProjectDocument =>
  JSON.parse(readFileSync("tests/fixtures/mixed-static/project.json", "utf8"));
it("samples value and physical velocity independently and frame-snaps dragged keys", () => {
  const keys: Keyframe[] = [
    { id: "a", at: 0, value: 0, interpolation: "linear" },
    { id: "b", at: 240000, value: 100, interpolation: "hold" },
  ];
  expect(sampleCurveGraph(keys, 240000, "value", 3).map((p) => p.value)).toEqual([0, 50, 100]);
  expect(sampleCurveGraph(keys, 240000, "velocity", 3)[1].value).toBeCloseTo(100);
  const key = makeDraggedKey(keys[0], 123456, 42, 240000, 8000);
  expect(key).toMatchObject({ at: 120000, value: 42 });
});
it("creates actual retimed motion commands from score event editing", () => {
  const doc = fixture();
  doc.channels["red:root:x"].owner = "recipe";
  doc.score.phrases = [
    {
      id: "p",
      range: { start: 0, end: 720000 },
      primaryActor: "red",
      eventIds: ["a"],
      grammar: "phrase-exchange",
    },
  ];
  doc.score.events = [{ id: "a", phraseId: "p", kind: "accent", tick: 240000, targetIds: ["red"] }];
  const commands = expectOk(commandsForEventChange(doc, "a", { tick: 360000 }));
  expect(commands.some((c) => c.type === "SetKeyframe" && c.key.at === 360000)).toBe(true);
  expect(commands.some((c) => c.type === "UpdateScore")).toBe(true);
});
it("persists grapheme identities and marks removed text units for inspection", () => {
  const initial = typePropsForText({}, "가나다", "grapheme");
  const changed = typePropsForText(initial, "가X다", "grapheme");
  expect((changed.textUnits as { id: string }[])[2].id).toBe((initial.textUnits as { id: string }[])[2].id);
  expect(changed.orphanTextUnitIds).toEqual([(initial.textUnits as { id: string }[])[1].id]);
});
it("renders accessible controls with an empty selection and a selected layer", () => {
  const document = fixture();
  const props: PanelProps = {
    document,
    selection: ["red"],
    tick: 0,
    submit: async () => true,
    refresh: async () => {},
    notify: () => {},
    api: async <T>() => ok(undefined as T),
  };
  expect(renderToStaticMarkup(createElement(CurveEditor, props))).toContain("Value graph");
  expect(renderToStaticMarkup(createElement(ScorePanel, props))).toContain("Create phrase");
  expect(renderToStaticMarkup(createElement(TypePanel, props))).toContain("Source text");
  expect(renderToStaticMarkup(createElement(CurveEditor, { ...props, selection: [] }))).toContain(
    "Select a layer",
  );
});

it("transfers only recipe-required wrapper channels and preserves manual nested targets", () => {
  const doc = fixture();
  doc.definitions.red.targets.push({ key: "detail", channels: ["x"], coordinateSpace: "local" });
  doc.channels["red:detail:x"] = {
    target: { instanceId: "red", targetKey: "detail", channel: "x" },
    owner: "manual",
    locked: false,
    keys: [{ id: "detail-x", at: 0, value: 4, interpolation: "hold" }],
  };
  expect(recipeOwnershipCommands(doc, ["red"], "phrase-exchange")).toEqual([
    { type: "SetChannelOwner", channelId: "red:root:x", owner: "recipe" },
  ]);
});
