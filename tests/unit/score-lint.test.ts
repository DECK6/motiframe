import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { reviewProject } from "../../packages/core/src/review/report";
import { lintScore } from "../../packages/core/src/score/lint";
import type { ProjectDocument } from "../../packages/document/src/schema";

const fixture = (): ProjectDocument =>
  JSON.parse(readFileSync("tests/fixtures/mixed-static/project.json", "utf8"));
it("permits long closure holds and flags unassigned holds as warnings", () => {
  const doc = fixture();
  expect(lintScore(doc).some((i) => i.code === "HOLD_WITHOUT_ROLE")).toBe(true);
  doc.score.windows = [
    { id: "end", range: { start: 0, end: 1440000 }, targetIds: ["red", "blue"], role: "closure" },
  ];
  expect(lintScore(doc).some((i) => i.code === "HOLD_WITHOUT_ROLE")).toBe(false);
});
it("reports separate observations without an aesthetic score", () => {
  const doc = fixture();
  const review = reviewProject(doc);
  expect(review).toHaveProperty("technical");
  expect(review).toHaveProperty("implementation");
  expect(review).toHaveProperty("perception");
  expect(review).not.toHaveProperty("score");
  expect(review.perception.some((o) => o.status === "unverified")).toBe(true);
});
