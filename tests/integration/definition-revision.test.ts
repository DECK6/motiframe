import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { inspectDefinitionMigration, reconcileDefinition } from "../../packages/authoring/src/reconcile";
import { definitionKey } from "../../packages/authoring/src/revisions";
import { applyTransaction, projectContentHash } from "../../packages/document/src/apply";
import { commitHistory, createHistory, undo } from "../../packages/document/src/history";
import type { ProjectDocument } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

const fixture = (): ProjectDocument => {
  const d: ProjectDocument = JSON.parse(readFileSync("tests/fixtures/mixed-static/project.json", "utf8"));
  d.instances.blue.definitionId = "red";
  return d;
};
it("versions selected instances without changing overrides, channel keys or other instances", () => {
  const doc = fixture();
  const old = structuredClone(doc);
  const manifest = {
    ...doc.definitions.red,
    revision: 2,
    moduleHash: "new-source",
    propsSchema: { type: "object", properties: { color: { type: "string", default: "green" } } },
  };
  const result = expectOk(
    reconcileDefinition(
      doc,
      { definitionId: "red", revision: 1 },
      { manifest, moduleHash: "new-source" },
      { instanceIds: ["red"] },
    ),
  );
  expect(result.document.instances.red.props).toEqual(doc.instances.red.props);
  expect(result.document.instances.red.definitionId).toBe(definitionKey("red", 2));
  expect(result.document.instances.blue.definitionId).toBe("red");
  expect(result.document.definitions.red.revision).toBe(1);
  expect(result.document.channels).toEqual(doc.channels);
  expect(result.document.revision).toBe(1);
  expect(doc).toEqual(old);
});
it("reports missing targets and requires explicit valid remapping", () => {
  const doc = fixture();
  const manifest = {
    ...doc.definitions.red,
    revision: 2,
    moduleHash: "next",
    targets: [{ key: "new-root", channels: ["x", "y", "opacity"], coordinateSpace: "local" as const }],
  };
  const artifact = { manifest, moduleHash: "next" };
  expect(
    reconcileDefinition(doc, { definitionId: "red", revision: 1 }, artifact, { instanceIds: ["red"] }),
  ).toMatchObject({ ok: false, error: { code: "TARGET_MIGRATION_REQUIRED" } });
  expect(
    expectOk(
      inspectDefinitionMigration(doc, { definitionId: "red", revision: 1 }, artifact, {
        instanceIds: ["red"],
      }),
    ).orphanTargets,
  ).toHaveLength(2);
  const migrated = expectOk(
    reconcileDefinition(doc, { definitionId: "red", revision: 1 }, artifact, {
      instanceIds: ["red"],
      targetRemap: { root: "new-root" },
    }),
  );
  expect(migrated.document.channels["red:root:x"].target.targetKey).toBe("new-root");
  expect(migrated.document.channels["red:root:x"].keys).toEqual(doc.channels["red:root:x"].keys);
  expect(migrated.document.channels["blue:root:x"].target.targetKey).toBe("root");
});
it("refuses incompatible props, stale sources and lock conflicts", () => {
  const doc = fixture();
  const artifact = {
    manifest: {
      ...doc.definitions.red,
      revision: 2,
      moduleHash: "next",
      propsSchema: { type: "object", properties: { color: { type: "number" } } },
    },
    moduleHash: "next",
  };
  expect(
    reconcileDefinition(doc, { definitionId: "red", revision: 1 }, artifact, { instanceIds: ["red"] }),
  ).toMatchObject({ ok: false, error: { code: "PROPS_MIGRATION_REQUIRED" } });
  expect(
    reconcileDefinition(doc, { definitionId: "red", revision: 9 }, artifact, { instanceIds: ["red"] }),
  ).toMatchObject({ ok: false, error: { code: "DEFINITION_REVISION" } });
  doc.instances.red.locked = true;
  expect(
    reconcileDefinition(
      doc,
      { definitionId: "red", revision: 1 },
      { ...artifact, manifest: { ...artifact.manifest, propsSchema: {} } },
      { instanceIds: ["red"] },
    ),
  ).toMatchObject({ ok: false, error: { code: "LOCKED" } });
});
it("applies revision switching atomically through ordinary history", () => {
  const doc = fixture();
  const original = projectContentHash(doc);
  const manifest = { ...doc.definitions.red, revision: 2, moduleHash: "next" };
  const transaction = {
    id: "rev",
    baseRevision: 0,
    author: "user" as const,
    scope: { instanceIds: ["red"], range: { start: 0, end: 1440000 }, preserveDuration: true, ripple: false },
    commands: [
      {
        type: "ApplyDefinitionRevision" as const,
        oldRef: { definitionId: "red", revision: 1 },
        artifact: { manifest, moduleHash: "next" },
        instanceIds: ["red"],
      },
    ],
  };
  const history = expectOk(commitHistory(createHistory(doc), transaction));
  expect(history.document.instances.red.definitionRevision).toBe(2);
  expect(projectContentHash(expectOk(undo(history)).document)).toBe(original);
  const scoped = { ...transaction, scope: { ...transaction.scope, instanceIds: ["blue"] } };
  expect(applyTransaction(doc, scoped).ok).toBe(false);
});
it("accepts a full build artifact while transporting only metadata in edit commands", () => {
  const doc = fixture();
  const artifact = {
    manifest: { ...doc.definitions.red, revision: 2, moduleHash: "built-hash" },
    moduleHash: "built-hash",
    bundlePath: "definitions/built-hash.js",
    code: "/* built browser module */",
    diagnostics: [],
  };
  expect(
    reconcileDefinition(doc, { definitionId: "red", revision: 1 }, artifact, { instanceIds: ["red"] }).ok,
  ).toBe(true);
});
