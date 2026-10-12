import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { evaluateCurve } from "../../packages/core/src/curves";
import { resolveHandoff } from "../../packages/core/src/score/handoff";
import { planPhrase, recipes } from "../../packages/core/src/score/recipes";
import { applyTransaction } from "../../packages/document/src/apply";
import type { ProjectDocument } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

const fixture = (): ProjectDocument => {
  const d: ProjectDocument = JSON.parse(readFileSync("tests/fixtures/mixed-static/project.json", "utf8"));
  for (const c of Object.values(d.channels)) c.owner = "recipe";
  for (const definition of Object.values(d.definitions)) definition.targets[0].channels.push("clipProgress");
  return d;
};
it.each([
  "phrase-exchange",
  "anticipation-release",
  "stagger-response",
  "anchor-wipe",
  "match-cut",
  "hold-variation",
])("plans %s without changing text or shape props", (grammar) => {
  const doc = fixture();
  const planned = expectOk(
    planPhrase(doc, {
      id: "p",
      range: { start: 0, end: 720000 },
      grammar,
      actorIds: ["red", "blue"],
      events: [],
      windows: [],
      handoffs: [],
    }),
  );
  const applied = expectOk(applyTransaction(doc, planned)).document;
  expect(applied.instances.red.props).toEqual(doc.instances.red.props);
  expect(applied.score.phrases).toHaveLength(1);
  expect(planned.commands.some((c) => c.type === "SetKeyframe")).toBe(true);
  expect(recipes.find((r) => r.id === grammar)?.counterexamples.length).toBeGreaterThan(0);
});
it("matches wrapper positions and rejects a continuous instantaneous swap", () => {
  const d = fixture();
  const handoff = {
    id: "h",
    fromTarget: "red",
    toTarget: "blue",
    at: 360000,
    mode: "match-cut" as const,
    preserve: ["position" as const],
  };
  const out = expectOk(applyTransaction(d, expectOk(resolveHandoff(d, handoff)))).document;
  for (const channel of ["x", "y"])
    expect(expectOk(evaluateCurve(out.channels[`blue:root:${channel}`].keys, 360000))).toBeCloseTo(50, 6);
  expect(resolveHandoff(d, { ...handoff, mode: "continuous" })).toMatchObject({
    ok: false,
    error: { code: "MISSING_CONTINUOUS_STATE" },
  });
});
it("rejects cyclic handoffs and manual destination channels", () => {
  const d = fixture();
  d.channels["blue:root:x"].owner = "manual";
  const handoff = {
    id: "h",
    fromTarget: "red",
    toTarget: "blue",
    at: 360000,
    mode: "match-cut" as const,
    preserve: ["position" as const],
  };
  expect(resolveHandoff(d, handoff)).toMatchObject({ ok: false, error: { code: "OWNERSHIP_CONFLICT" } });
  d.channels["blue:root:x"].owner = "recipe";
  d.score.handoffs = [{ ...handoff, id: "reverse", fromTarget: "blue", toTarget: "red" }];
  expect(resolveHandoff(d, handoff).ok).toBe(false);
});
it("uses an actual crop channel for anchor wipes and a discontinuous visibility exchange for match cuts", () => {
  const doc = fixture();
  for (const definition of Object.values(doc.definitions))
    definition.targets[0].channels.push("clipProgress");
  const wipe = expectOk(
    applyTransaction(
      doc,
      expectOk(
        planPhrase(doc, {
          id: "wipe",
          range: { start: 0, end: 720000 },
          grammar: "anchor-wipe",
          actorIds: ["red"],
          events: [],
          windows: [],
          handoffs: [],
        }),
      ),
    ),
  ).document;
  expect(wipe.channels["red:root:clipProgress"]).toBeDefined();
  expect(expectOk(evaluateCurve(wipe.channels["red:root:clipProgress"].keys, 0))).toBe(0);
  const cut = expectOk(
    applyTransaction(
      doc,
      expectOk(
        planPhrase(doc, {
          id: "cut",
          range: { start: 0, end: 720000 },
          grammar: "match-cut",
          actorIds: ["red", "blue"],
          events: [],
          windows: [],
          handoffs: [],
        }),
      ),
    ),
  ).document;
  const before = 359999,
    at = 360000;
  expect(expectOk(evaluateCurve(cut.channels["red:root:opacity"].keys, before))).toBe(1);
  expect(expectOk(evaluateCurve(cut.channels["blue:root:opacity"].keys, before))).toBe(0);
  expect(expectOk(evaluateCurve(cut.channels["red:root:opacity"].keys, at))).toBe(0);
  expect(expectOk(evaluateCurve(cut.channels["blue:root:opacity"].keys, at))).toBe(1);
});
