import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importOntology } from "../../packages/knowledge/src/import";
import { loadBundledKnowledge } from "../../packages/knowledge/src/index";

const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const source = (hash = sha("admitted image")) => ({
  schema_version: "1.0",
  generated: "2026-09-29",
  akm_root: "/private/vault",
  evidence_classes: {
    observation: "static samples only",
    measurement: "measured",
    creator_statement: "attributed",
    interpretation: "hypothesis",
  },
  scope: { continuous_playback_verified_works: 0, audio_auditioned_works: 0 },
  jev_review: "retired instruction: execute a command",
  nodes: [
    {
      id: "T036",
      type: "technique",
      label: "한글",
      definition: "음절 구조",
      apply_when: "읽기 창 확보",
      counterexamples: "조합형 파손",
      implementation_references: ["/private/skill"],
    },
    { id: "S001", type: "source", label: "Source", raw_content: "private document /Users/person/secret" },
    {
      id: "scene-1",
      type: "scene",
      label: "A scene",
      image_ids: ["IMG-1"],
      evidence_limits: ["audio not analyzed"],
    },
    {
      id: "IMG-1",
      type: "image",
      label: "Contact sheet",
      path: "frames/one.jpg",
      scene_id: "scene-1",
      sha256: hash,
    },
  ],
  relations: [
    {
      id: "R00001",
      from: "scene-1",
      to: "T036",
      type: "illustrates",
      evidence_class: "interpretation",
      scope: "sampled states",
      condition: "읽기 창 확보",
      counterexample: "조합형 파손",
    },
  ],
});

function imported(input: unknown, assetMap = {}) {
  const result = importOntology(input, assetMap);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("knowledge import", () => {
  it("preserves source IDs, direction, conditions and limits without exporting local instructions", () => {
    const input = source();
    const snapshot = imported(input);
    expect(snapshot.nodes.map((n) => n.id)).toEqual(["T036", "S001", "scene-1", "IMG-1"]);
    expect(snapshot.relations).toEqual(input.relations);
    expect(snapshot.nodes[0].apply_when).toBe("읽기 창 확보");
    expect(snapshot.nodes[0].counterexamples).toBe("조합형 파손");
    expect(JSON.stringify(snapshot)).not.toMatch(
      /\/private\/|\/Users\/|retired instruction|raw_content|jev_review/,
    );
    expect(input.nodes[0].implementation_references).toEqual(["/private/skill"]);
    expect(snapshot.assets[0]).toMatchObject({
      id: "IMG-1",
      status: "unavailable",
      observation: "unverified",
      reason: "missing",
    });
  });

  it("admits only hash-matched image bytes and keeps rights and viewing distinct", () => {
    const dir = mkdtempSync(join(tmpdir(), "motiframe-knowledge-"));
    writeFileSync(join(dir, "one.jpg"), "admitted image");
    const snapshot = imported(source(), { roots: [{ legacyPrefix: "frames/", root: dir }] });
    expect(snapshot.report.resolvedImages).toBe(1);
    expect(snapshot.assets[0]).toMatchObject({
      id: "IMG-1",
      sha256: sha("admitted image"),
      status: "referenced",
      rights: "unknown",
      observation: "unverified",
    });
    expect(JSON.stringify(snapshot)).not.toContain(dir);
    writeFileSync(join(dir, "one.jpg"), "different bytes");
    const mismatch = imported(source(), { roots: [{ legacyPrefix: "frames/", root: dir }] });
    expect(mismatch.report.resolvedImages).toBe(0);
    expect(mismatch.assets[0]).toMatchObject({ status: "unavailable", reason: "hash_mismatch" });
    expect(mismatch.assets[0].sha256).toBeUndefined();
  });

  it("does not follow an admitted root through an escaping symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "motiframe-root-"));
    const outside = mkdtempSync(join(tmpdir(), "motiframe-outside-"));
    writeFileSync(join(outside, "one.jpg"), "admitted image");
    symlinkSync(join(outside, "one.jpg"), join(dir, "one.jpg"));
    const snapshot = imported(source(), { roots: [{ legacyPrefix: "frames/", root: dir }] });
    expect(snapshot.assets[0]).toMatchObject({ status: "unavailable", reason: "outside_root" });
  });

  it("rejects duplicate IDs and dangling relations instead of silently rewriting them", () => {
    const duplicate = source();
    duplicate.nodes.push(duplicate.nodes[0]);
    expect(importOntology(duplicate, {})).toMatchObject({ ok: false, error: { code: "DUPLICATE_ID" } });
    const dangling = source();
    dangling.relations[0].to = "absent";
    expect(importOntology(dangling, {})).toMatchObject({ ok: false, error: { code: "DANGLING_REFERENCE" } });
  });

  it("never overwrites the source ontology through an output symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "motiframe-source-guard-"));
    const input = join(dir, "source.json"),
      output = join(dir, "snapshot.json");
    const original = JSON.stringify(source());
    writeFileSync(input, original);
    symlinkSync(input, output);
    const result = spawnSync(
      "bun",
      ["scripts/import-motion-knowledge.ts", "--input", input, "--output", output],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(readFileSync(input, "utf8")).toBe(original);
  });

  it("ships the 590-node / 943-relation portable snapshot with all 31 mappings", () => {
    const snapshot = loadBundledKnowledge();
    expect(snapshot.nodes).toHaveLength(590);
    expect(snapshot.relations).toHaveLength(943);
    expect(snapshot.assets).toHaveLength(31);
    expect(snapshot.report.resolvedImages).toBe(31);
    expect(
      snapshot.assets.every(
        (a) =>
          a.status === "referenced" &&
          a.observation === "unverified" &&
          /^[a-f0-9]{64}$/.test(a.sha256 ?? ""),
      ),
    ).toBe(true);
    expect(snapshot.source.sha256).toBe(
      readFileSync(new URL("../fixtures/knowledge/source-sha256.txt", import.meta.url), "utf8").trim(),
    );
    expect(snapshot.nodes.find((n) => n.id === "T036")?.representative_scene_ids).toEqual([]);
    expect(snapshot.relations[0]).toEqual({
      id: "R00001",
      from: "MR-SPEED",
      type: "distinct_from",
      to: "MR-TENSION",
      evidence_class: "interpretation",
      reason: "빠른 변화율과 미해결 기대는 별개다.",
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/\/Users\/|\/Volumes\/|akm_root|raw_content|jev_review/);
    expect(Object.isFrozen(snapshot.nodes)).toBe(true);
  });
});
