import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { openDocumentService } from "../../apps/runner/src/project-storage";
import { saveProject } from "../../packages/document/src/persistence";
import { createStarterProject } from "../../packages/document/src/starter";
import { expectOk } from "../helpers/result";

it("keeps undo and retry receipts separate for two project files in one folder", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motiframe-state-")),
    a = path.join(dir, "a.json"),
    b = path.join(dir, "b.json");
  const doc = createStarterProject();
  for (const file of [a, b]) expectOk(await saveProject(doc, file));
  const tx = {
    id: "same-id",
    baseRevision: 0,
    author: "agent" as const,
    scope: {
      instanceIds: ["title"],
      range: { start: 0, end: doc.settings.duration },
      preserveDuration: true,
      ripple: false,
    },
    commands: [{ type: "SetProps" as const, instanceId: "title", props: { color: "#123456" } }],
  };
  const first = expectOk(await openDocumentService(a));
  const receipt = expectOk(await first.submit(tx));
  const second = expectOk(await openDocumentService(b));
  expectOk(
    await second.submit({
      ...tx,
      commands: [{ type: "SetProps", instanceId: "title", props: { color: "#abcdef" } }],
    }),
  );
  const reopened = expectOk(await openDocumentService(a));
  expect(reopened.historyState.past).toHaveLength(1);
  expect(expectOk(await reopened.submit(tx))).toEqual(receipt);
  expectOk(await reopened.undo());
  expect(reopened.document.instances.title.props.color).toBe(doc.instances.title.props.color);
});
