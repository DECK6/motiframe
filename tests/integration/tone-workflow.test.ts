import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { openDocumentService } from "../../apps/runner/src/project-storage";
import { addToneScore } from "../../apps/runner/src/score-audio";
import { saveProject } from "../../packages/document/src/persistence";
import { createStarterProject } from "../../packages/document/src/starter";
import { expectOk } from "../helpers/result";

it("adds a synthesized cue through shared document history and reuses its samples at another timeline position", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motiframe-cue-")),
    file = path.join(dir, "project.json");
  expectOk(await saveProject(createStarterProject(), file));
  const service = expectOk(await openDocumentService(file));
  const score = { durationTicks: 240000, notes: [{ at: 60000, duration: 60000, pitch: "C4" }] };
  const first = expectOk(await addToneScore(service, score, dir));
  expect(first.samples).toBe(48000);
  expect(service.document.instances[first.instanceId].start).toBe(0);
  expect(Object.keys(service.document.assets)).toEqual([first.assetId]);
  const second = expectOk(await addToneScore(service, { ...score, startTick: 240000 }, dir));
  expect(second.assetId).toBe(first.assetId);
  expect(service.document.instances[second.instanceId].start).toBe(240000);
  expect(service.document.mediaClips[second.instanceId]).toMatchObject({ sourceIn: 0, sourceOut: 240000 });
  expectOk(await service.undo());
  expect(service.document.instances[second.instanceId]).toBeUndefined();
  expect(service.document.instances[first.instanceId]).toBeDefined();
});
