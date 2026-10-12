import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { compileScore } from "../../packages/core/src/score/compile";
import { applyTransaction } from "../../packages/document/src/apply";
import type { ProjectDocument } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

const fixture = (): ProjectDocument =>
  JSON.parse(readFileSync("tests/fixtures/mixed-static/project.json", "utf8"));
it("retimes recipe motion to project-global events and preserves unrelated manual channels", () => {
  const doc = fixture();
  doc.instances.red.start = 8000;
  doc.instances.red.duration -= 8000;
  doc.channels["red:root:x"].owner = "recipe";
  doc.channels["red:root:x"].recipeId = "phrase";
  doc.score.phrases = [
    {
      id: "phrase",
      range: { start: 8000, end: 720000 },
      primaryActor: "red",
      eventIds: ["on", "accent"],
      grammar: "phrase-exchange",
    },
  ];
  doc.score.events = [
    { id: "on", phraseId: "phrase", kind: "onset", tick: 8000, targetIds: ["red"] },
    { id: "accent", phraseId: "phrase", kind: "accent", tick: 288000, targetIds: ["red"] },
  ];
  const first = expectOk(applyTransaction(doc, expectOk(compileScore(doc)))).document;
  (first.score.events[1] as { tick: number }).tick = 360000;
  const updated = expectOk(applyTransaction(first, expectOk(compileScore(first)))).document;
  expect(updated.channels["red:root:x"].keys.some((k) => k.at === 352000)).toBe(true);
  expect(updated.channels["red:root:y"]).toEqual(doc.channels["red:root:y"]);
});
it("rejects manual ownership and a motion event inside a reading window", () => {
  const doc = fixture();
  doc.score.phrases = [
    {
      id: "p",
      range: { start: 0, end: 720000 },
      primaryActor: "red",
      eventIds: ["a"],
      grammar: "phrase-exchange",
    },
  ];
  doc.score.events = [{ id: "a", phraseId: "p", kind: "accent", tick: 360000, targetIds: ["red"] }];
  expect(compileScore(doc)).toMatchObject({ ok: false, error: { code: "OWNERSHIP_CONFLICT" } });
  doc.channels["red:root:x"].owner = "recipe";
  doc.channels["red:root:x"].recipeId = "p";
  doc.score.windows = [
    { id: "read", range: { start: 240000, end: 480000 }, targetIds: ["red"], role: "reading" },
  ];
  expect(compileScore(doc)).toMatchObject({ ok: false, error: { code: "READING_WINDOW_CONFLICT" } });
});
it("allows an intentionally unresolved ending and rejects malformed event references", () => {
  const doc = fixture();
  doc.channels["red:root:x"].owner = "recipe";
  doc.score.phrases = [
    {
      id: "p",
      range: { start: 0, end: 720000 },
      primaryActor: "red",
      eventIds: ["a"],
      grammar: "hold-variation",
    },
  ];
  doc.score.events = [{ id: "a", phraseId: "p", kind: "prepare", tick: 360000, targetIds: ["red"] }];
  doc.score.tensions = [
    { id: "t", cueEvent: "a", unresolvedState: "Held before release", intentionalUnresolvedEnd: true },
  ];
  expect(compileScore(doc).ok).toBe(true);
  (doc.score.phrases[0] as { eventIds: string[] }).eventIds.push("missing");
  expect(compileScore(doc).ok).toBe(false);
});
it("recompiles without cumulative spatial drift and compiles handoff constraints", () => {
  const doc = fixture();
  for (const channel of Object.values(doc.channels)) channel.owner = "recipe";
  doc.score.phrases = [
    {
      id: "p",
      range: { start: 0, end: 720000 },
      primaryActor: "red",
      eventIds: ["on", "a"],
      grammar: "phrase-exchange",
    },
  ];
  doc.score.events = [
    { id: "on", phraseId: "p", kind: "onset", tick: 0, targetIds: ["red"] },
    { id: "a", phraseId: "p", kind: "accent", tick: 360000, targetIds: ["red"] },
  ];
  const first = expectOk(applyTransaction(doc, expectOk(compileScore(doc)))).document;
  const second = expectOk(applyTransaction(first, expectOk(compileScore(first)))).document;
  expect(second.channels).toEqual(first.channels);
  second.score.handoffs = [
    { id: "h", fromTarget: "red", toTarget: "blue", at: 360000, mode: "match-cut", preserve: ["position"] },
  ];
  const handoff = expectOk(applyTransaction(second, expectOk(compileScore(second)))).document;
  expect(handoff.channels["blue:root:x"].keys.some((k) => k.at === 360000 && k.value === 50)).toBe(true);
});
