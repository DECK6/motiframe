import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { RenderJobManager, type RenderJobState } from "../../apps/runner/src/jobs";
import type { ProjectDocument } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

async function fixture() {
  const doc = JSON.parse(
    await readFile("tests/fixtures/mixed-static/project.json", "utf8"),
  ) as ProjectDocument;
  doc.settings.duration = 16000;
  return doc;
}
it("queues isolated revision snapshots and reports every render phase", async () => {
  const doc = await fixture(),
    manager = new RenderJobManager({ concurrency: 1 }),
    events = new Map<string, RenderJobState[]>();
  const unsubscribe = manager.subscribe((job) => {
    events.set(job.jobId, [...(events.get(job.jobId) ?? []), job.state]);
  });
  const first = expectOk(
    manager.start(doc, {
      projectDir: path.resolve("tests/fixtures/mixed-static"),
      outputPath: path.resolve(`artifacts/jobs/${randomUUID()}-first.mp4`),
    }),
  );
  const second = expectOk(
    manager.start(doc, {
      projectDir: path.resolve("tests/fixtures/mixed-static"),
      outputPath: path.resolve(`artifacts/jobs/${randomUUID()}-second.mp4`),
    }),
  );
  expect(expectOk(manager.status(second.jobId)).state).toBe("queued");
  doc.revision = 999;
  doc.settings.width = 1;
  const result = expectOk(await manager.wait(first.jobId));
  expect(result.revision).not.toBe(999);
  expect(result.frames).toBe(2);
  expectOk(await manager.wait(second.jobId));
  expect(events.get(first.jobId)).toEqual(
    expect.arrayContaining(["queued", "preparing", "rendering", "encoding", "completed"]),
  );
  expect(expectOk(manager.status(first.jobId))).toMatchObject({
    state: "completed",
    progress: { completed: 2, total: 2 },
  });
  unsubscribe();
}, 120000);
it("cancels active and queued jobs without allowing late completion", async () => {
  const doc = await fixture();
  doc.settings.duration = 240000;
  const manager = new RenderJobManager();
  let cancelledAt = 0;
  const first = expectOk(
    manager.start(doc, {
      projectDir: path.resolve("tests/fixtures/mixed-static"),
      outputPath: path.resolve(`artifacts/jobs/${randomUUID()}-cancelled.mp4`),
      onProgress: () => {
        if (!cancelledAt) {
          cancelledAt = performance.now();
          expectOk(manager.cancel(first.jobId));
        }
      },
    }),
  );
  const queued = expectOk(
    manager.start(doc, {
      projectDir: path.resolve("tests/fixtures/mixed-static"),
      outputPath: path.resolve(`artifacts/jobs/${randomUUID()}-queued.mp4`),
    }),
  );
  expectOk(manager.cancel(queued.jobId));
  expect(await manager.wait(queued.jobId)).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  expect(await manager.wait(first.jobId)).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  expect(performance.now() - cancelledAt).toBeLessThan(1000);
  expect(expectOk(manager.status(first.jobId)).state).toBe("cancelled");
  expectOk(manager.cancel(first.jobId));
}, 120000);
it("normalizes unknown ids and expires render deadlines", async () => {
  const manager = new RenderJobManager({ deadlineMs: 1 });
  expect(manager.status("missing")).toMatchObject({ ok: false, error: { code: "UNKNOWN_JOB" } });
  expect(manager.cancel("missing")).toMatchObject({ ok: false, error: { code: "UNKNOWN_JOB" } });
  expect(await manager.wait("missing")).toMatchObject({ ok: false, error: { code: "UNKNOWN_JOB" } });
  const job = expectOk(
    manager.start(await fixture(), {
      projectDir: path.resolve("tests/fixtures/mixed-static"),
      outputPath: path.resolve(`artifacts/jobs/${randomUUID()}-deadline.mp4`),
    }),
  );
  expect(await manager.wait(job.jobId)).toMatchObject({ ok: false, error: { code: "RENDER_TIMEOUT" } });
  expect(expectOk(manager.status(job.jobId)).state).toBe("failed");
}, 60000);
