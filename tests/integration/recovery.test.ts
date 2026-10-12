import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { openDocumentService, projectStatePaths } from "../../apps/runner/src/project-storage";
import { saveProject } from "../../packages/document/src/persistence";
import { createStarterProject } from "../../packages/document/src/starter";
import { expectOk } from "../helpers/result";

it("replays a lost commit response once across runner restart and recovers a prepared history checkpoint", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motiframe-recover-")),
    file = path.join(dir, "project.json"),
    doc = createStarterProject();
  expectOk(await saveProject(doc, file));
  let service = expectOk(await openDocumentService(file));
  const tx = {
    id: "lost-response",
    baseRevision: 0,
    author: "agent" as const,
    scope: {
      instanceIds: ["title"],
      range: { start: 0, end: doc.settings.duration },
      preserveDuration: true,
      ripple: false,
    },
    commands: [{ type: "SetProps" as const, instanceId: "title", props: { color: "#ff0000" } }],
  };
  const receipt = expectOk(await service.submit(tx));
  const paths = await projectStatePaths(file);
  await rename(paths.history, paths.journal);
  service = expectOk(await openDocumentService(file));
  expect(expectOk(await service.submit(tx))).toEqual(receipt);
  expect(service.document.revision).toBe(1);
  expect(service.historyState.past.length).toBe(1);
  const reused = await service.submit({
    ...tx,
    commands: [{ type: "SetProps", instanceId: "title", props: { color: "#00ff00" } }],
  });
  expect(reused).toMatchObject({ ok: false, error: { code: "REQUEST_ID_REUSED" } });
  expectOk(await service.undo());
  expect(service.document.instances.title.props.color).toBe(doc.instances.title.props.color);
});
