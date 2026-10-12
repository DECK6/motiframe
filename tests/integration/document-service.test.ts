import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { DocumentService } from "../../apps/runner/src/document-service";
import type { EditTransaction } from "../../packages/document/src/commands";
import { fail, ok } from "../../packages/document/src/result";
import type { ProjectDocument } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

const fixture = async () =>
  JSON.parse(await readFile("tests/fixtures/mixed-static/project.json", "utf8")) as ProjectDocument;
function edit(doc: ProjectDocument, id: string): EditTransaction {
  const instanceId = Object.keys(doc.instances)[0];
  return {
    id,
    baseRevision: doc.revision,
    author: "agent",
    scope: {
      instanceIds: [instanceId],
      range: { start: 0, end: doc.settings.duration },
      preserveDuration: true,
      ripple: false,
    },
    commands: [{ type: "SetProps", instanceId, props: { color: "#ffffff" } }],
  };
}
it("serializes competing writers and exposes agent edits through shared undo and revision events", async () => {
  const doc = await fixture();
  const service = new DocumentService(doc, { save: async () => ok(undefined) });
  const [first, second] = await Promise.all([
    service.submit(edit(doc, "first")),
    service.submit(edit(doc, "second")),
  ]);
  expectOk(first);
  expect(second.ok).toBe(false);
  if (!second.ok) expect(second.error.code).toBe("REVISION_CONFLICT");
  expect(service.eventsAfter(0).map((e) => e.requestId)).toEqual(["first"]);
  expectOk(await service.undo());
  expect(service.document.instances).toEqual(doc.instances);
  expect(service.document.revision).toBe(2);
  expectOk(await service.redo());
  expect(service.document.revision).toBe(3);
});
it("leaves memory and history unchanged when atomic persistence fails", async () => {
  const doc = await fixture();
  const service = new DocumentService(doc, { save: async () => fail("DISK_FULL", "Save failed") });
  expect((await service.submit(edit(doc, "failure"))).ok).toBe(false);
  expect(service.document).toEqual(doc);
  expect(service.eventsAfter(0)).toEqual([]);
});
