import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createVariant } from "../../packages/automation/src/variants";
import { applyTransaction, projectContentHash } from "../../packages/document/src/apply";
import type { EditTransaction } from "../../packages/document/src/commands";
import type { ProjectDocument } from "../../packages/document/src/schema";

const fixture = (): ProjectDocument =>
  JSON.parse(readFileSync("tests/fixtures/mixed-static/project.json", "utf8"));
const transaction = (doc: ProjectDocument): EditTransaction => ({
  id: "color-proposal",
  baseRevision: doc.revision,
  author: "agent",
  scope: {
    instanceIds: ["red"],
    range: { start: 0, end: doc.settings.duration },
    preserveDuration: true,
    ripple: false,
  },
  commands: [{ type: "SetProps", instanceId: "red", props: { color: "#00ff00" } }],
});

describe("immutable comparison variants", () => {
  it("creates a frozen candidate without changing the original document or transaction", () => {
    const doc = fixture(),
      tx = transaction(doc),
      original = structuredClone(doc),
      originalTx = structuredClone(tx);
    const result = createVariant(doc, tx, "색 변화");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(doc).toEqual(original);
    expect(tx).toEqual(originalTx);
    expect(result.value).toMatchObject({
      baseRevision: 0,
      label: "색 변화",
      document: { revision: 1, instances: { red: { props: { color: "#00ff00" } } } },
    });
    expect(result.value.document.instances.blue).toEqual(doc.instances.blue);
    expect(Object.isFrozen(result.value.document.instances.red.props)).toBe(true);
    expect(() => {
      result.value.document.instances.red.props.color = "mutated";
    }).toThrow();
  });
  it("keeps identity stable for the same candidate and changes it for different content", () => {
    const doc = fixture(),
      tx = transaction(doc);
    const one = createVariant(doc, tx),
      two = createVariant(doc, tx);
    expect(one.ok && two.ok && one.value.id === two.value.id).toBe(true);
    const other = structuredClone(tx);
    other.commands = [{ type: "SetProps", instanceId: "red", props: { color: "#000000" } }];
    const three = createVariant(doc, other);
    expect(one.ok && three.ok && one.value.id !== three.value.id).toBe(true);
  });
  it("retains stale revision, locked target and manual channel guards", () => {
    const doc = fixture(),
      tx = transaction(doc);
    expect(createVariant(doc, { ...tx, baseRevision: 99 })).toMatchObject({
      ok: false,
      error: { code: "REVISION_CONFLICT" },
    });
    const locked = structuredClone(doc);
    locked.instances.red.locked = true;
    expect(createVariant(locked, tx)).toMatchObject({ ok: false, error: { code: "LOCKED" } });
    const manual = structuredClone(tx);
    manual.author = "recipe";
    manual.commands = [
      {
        type: "SetKeyframe",
        channelId: "red:root:x",
        key: { id: "new-x", at: 0, value: 100, interpolation: "hold" },
      },
    ];
    expect(createVariant(doc, manual)).toMatchObject({ ok: false, error: { code: "OWNERSHIP_CONFLICT" } });
  });
  it("accepts only the original guarded transaction and reproduces the candidate content", () => {
    const doc = fixture(),
      tx = transaction(doc),
      candidate = createVariant(doc, tx);
    if (!candidate.ok) throw new Error(candidate.error.message);
    const applied = applyTransaction(doc, tx);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(projectContentHash(applied.value.document)).toBe(projectContentHash(candidate.value.document));
    expect(applyTransaction(applied.value.document, tx)).toMatchObject({
      ok: false,
      error: { code: "REVISION_CONFLICT" },
    });
  });
});
