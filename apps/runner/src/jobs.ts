import { randomUUID } from "node:crypto";
import { compileProject } from "../../../packages/core/src/compile";
import { fail, ok, type Problem, type Result } from "../../../packages/document/src/result";
import type { ProjectDocument } from "../../../packages/document/src/schema";
import { type RenderManifest, type RenderOptions, renderProject } from "./render-job";

export type RenderJobState =
  | "queued"
  | "preparing"
  | "rendering"
  | "encoding"
  | "completed"
  | "failed"
  | "cancelled";
export type RenderJobSnapshot = {
  jobId: string;
  revision: number;
  state: RenderJobState;
  progress: { completed: number; total: number };
  error?: Problem;
  result?: RenderManifest;
};
type ManagedJob = {
  snapshot: RenderJobSnapshot;
  document: ProjectDocument;
  options: RenderOptions;
  controller: AbortController;
  done: Promise<Result<RenderManifest>>;
  finish: (result: Result<RenderManifest>) => void;
  removeAbort: () => void;
  settled: boolean;
  timedOut: boolean;
};
function freeze<T>(input: T): T {
  if (input && typeof input === "object") {
    for (const value of Object.values(input)) freeze(value);
    Object.freeze(input);
  }
  return input;
}
export class RenderJobManager {
  private jobs = new Map<string, ManagedJob>();
  private queue: ManagedJob[] = [];
  private listeners = new Set<(job: RenderJobSnapshot) => void>();
  private active = 0;
  private concurrency: number;
  private deadlineMs: number;
  constructor(options: { concurrency?: number; deadlineMs?: number } = {}) {
    this.concurrency = options.concurrency ?? 1;
    this.deadlineMs = options.deadlineMs ?? 600000;
  }
  start(document: unknown, options: RenderOptions): Result<{ jobId: string }> {
    if (
      !Number.isSafeInteger(this.concurrency) ||
      this.concurrency < 1 ||
      this.concurrency > 4 ||
      !Number.isFinite(this.deadlineMs) ||
      this.deadlineMs <= 0
    )
      return fail("INVALID_JOB_OPTIONS", "Concurrency must be 1–4 and deadline must be positive");
    const compiled = compileProject(document);
    if (!compiled.ok) return compiled;
    const doc = freeze(structuredClone(compiled.value.document)),
      jobId = randomUUID(),
      controller = new AbortController();
    const range = options.range ? { ...options.range } : { start: 0, end: doc.settings.duration };
    let finish!: (result: Result<RenderManifest>) => void;
    const done = new Promise<Result<RenderManifest>>((resolve) => {
      finish = resolve;
    });
    const job: ManagedJob = {
      snapshot: {
        jobId,
        revision: doc.revision,
        state: "queued",
        progress: {
          completed: 0,
          total: Math.ceil(((range.end - range.start) * doc.settings.fps.num) / 240000),
        },
      },
      document: doc,
      options: { ...options, range },
      controller,
      done,
      finish,
      removeAbort: () => {},
      settled: false,
      timedOut: false,
    };
    this.jobs.set(jobId, job);
    this.queue.push(job);
    this.emit(job);
    const abort = () => {
      this.cancel(jobId);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    job.removeAbort = () => options.signal?.removeEventListener("abort", abort);
    if (options.signal?.aborted) abort();
    queueMicrotask(() => this.pump());
    return ok({ jobId });
  }
  cancel(jobId: string): Result<void> {
    const job = this.jobs.get(jobId);
    if (!job) return fail("UNKNOWN_JOB", "Render job does not exist", [jobId]);
    if (job.settled || job.snapshot.state === "cancelled") return ok(undefined);
    const queued = job.snapshot.state === "queued";
    job.controller.abort();
    job.snapshot.state = "cancelled";
    job.snapshot.error = { code: "CANCELLED", message: "Render job was cancelled", ids: [jobId] };
    this.emit(job);
    if (queued) this.settle(job, fail("CANCELLED", "Render job was cancelled", [jobId]));
    return ok(undefined);
  }
  status(jobId: string): Result<RenderJobSnapshot> {
    const job = this.jobs.get(jobId);
    return job
      ? ok(structuredClone(job.snapshot))
      : fail("UNKNOWN_JOB", "Render job does not exist", [jobId]);
  }
  async wait(jobId: string): Promise<Result<RenderManifest>> {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(await job.done) : fail("UNKNOWN_JOB", "Render job does not exist", [jobId]);
  }
  subscribe(listener: (job: RenderJobSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(job: ManagedJob) {
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(job.snapshot));
      } catch {
        /* Observers cannot change job execution. */
      }
    }
  }
  private setState(job: ManagedJob, state: RenderJobState) {
    if (job.snapshot.state === "cancelled" || job.settled) return;
    job.snapshot.state = state;
    this.emit(job);
  }
  private settle(job: ManagedJob, result: Result<RenderManifest>) {
    if (job.settled) return;
    job.settled = true;
    job.removeAbort();
    if (result.ok) {
      job.snapshot.state = "completed";
      job.snapshot.result = structuredClone(result.value);
    } else {
      job.snapshot.state = result.error.code === "CANCELLED" ? "cancelled" : "failed";
      job.snapshot.error = structuredClone(result.error);
    }
    this.emit(job);
    job.finish(result);
  }
  private pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      if (job.settled) continue;
      this.active++;
      void this.execute(job).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }
  private async execute(job: ManagedJob) {
    this.setState(job, "preparing");
    const timer = setTimeout(() => {
      if (job.snapshot.state === "cancelled" || job.settled) return;
      job.timedOut = true;
      job.controller.abort();
    }, this.deadlineMs);
    let result: Result<RenderManifest>;
    try {
      result = await renderProject(job.document, {
        ...job.options,
        signal: job.controller.signal,
        onProgress: (progress) => {
          if (job.controller.signal.aborted) return;
          job.snapshot.progress = { ...progress };
          this.setState(job, "rendering");
          try {
            job.options.onProgress?.({ ...progress });
          } catch {
            /* External UI observers do not own the render. */
          }
          if (progress.completed === progress.total) this.setState(job, "encoding");
        },
      });
    } catch (error) {
      result = fail("RENDER_FAILED", error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
    if (job.timedOut)
      result = fail("RENDER_TIMEOUT", "Render job exceeded its deadline", [job.snapshot.jobId]);
    else if (job.controller.signal.aborted)
      result = fail("CANCELLED", "Render job was cancelled", [job.snapshot.jobId]);
    this.settle(job, result);
  }
}
export const createRenderJobManager = (options: { concurrency?: number; deadlineMs?: number } = {}) =>
  new RenderJobManager(options);
