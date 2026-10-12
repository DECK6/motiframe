import { expect, it } from "vitest";
import { applyTransaction } from "../../packages/document/src/apply";
import { createStarterProject } from "../../packages/document/src/starter";

const scope = {
  instanceIds: ["title"],
  range: { start: 240000, end: 720000 },
  preserveDuration: true,
  ripple: false,
};
it("rejects moving a key from outside the allowed range using its existing ID", () => {
  const doc = createStarterProject();
  doc.channels["title:root:x"].owner = "manual";
  const result = applyTransaction(doc, {
    id: "escape",
    author: "agent",
    baseRevision: 0,
    scope,
    commands: [
      {
        type: "SetKeyframe",
        channelId: "title:root:x",
        key: { id: "tx0", at: 480000, value: 900, interpolation: "linear" },
      },
    ],
  });
  expect(result).toMatchObject({ ok: false, error: { code: "SCOPE_CONFLICT" } });
  expect(doc.channels["title:root:x"].keys[0].value).toBe(155);
});
it("rejects an in-range key edit whose incoming interpolation changes protected frames", () => {
  const doc = createStarterProject();
  doc.channels["title:root:x"].owner = "manual";
  const result = applyTransaction(doc, {
    id: "curve-escape",
    author: "agent",
    baseRevision: 0,
    scope,
    commands: [
      {
        type: "SetKeyframe",
        channelId: "title:root:x",
        key: { id: "tx1", at: 240000, value: 900, interpolation: "linear" },
      },
    ],
  });
  expect(result).toMatchObject({ ok: false, error: { code: "SCOPE_CONFLICT" } });
});
