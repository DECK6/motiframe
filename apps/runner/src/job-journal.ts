import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Problem } from "../../../packages/document/src/result";
import type { RenderJobSnapshot } from "./jobs";
export type RecoveredJob = RenderJobSnapshot & { interrupted?: boolean };
const integer = z.number().int().nonnegative();
const recordSchema = z
  .object({
    jobId: z.string().min(1),
    revision: integer,
    state: z.enum(["queued", "preparing", "rendering", "encoding", "completed", "failed", "cancelled"]),
    progress: z
      .object({ completed: integer, total: integer })
      .strict()
      .refine((p) => p.completed <= p.total),
    error: z
      .object({ code: z.string(), message: z.string(), ids: z.array(z.string()) })
      .strict()
      .optional(),
    result: z
      .object({
        revision: integer,
        runtimeHashes: z.record(z.string(), z.string()),
        frames: integer,
        fps: z.object({ num: z.number().int().positive(), den: z.number().int().positive() }).strict(),
        durationTicks: integer,
        assetsHash: z.string(),
        outputHash: z.string(),
        warnings: z.array(z.string()),
        outputPath: z.string(),
        audioPath: z.string(),
      })
      .strict()
      .optional(),
    interrupted: z.boolean().optional(),
  })
  .strict();
const journalSchema = z.array(z.tuple([z.string(), recordSchema])).superRefine((records, ctx) => {
  for (const [id, record] of records)
    if (record.jobId !== id)
      ctx.addIssue({ code: "custom", message: "Journal key must match job ID", path: [id] });
});
export class JobJournal {
  private records: Record<string, RecoveredJob> = Object.create(null);
  private tail: Promise<void> = Promise.resolve();
  private preserveBeforeWrite = false;
  loadError: Problem | null = null;
  constructor(private file: string) {}
  async load(): Promise<RecoveredJob[]> {
    await this.tail.catch(() => {});
    this.loadError = null;
    this.preserveBeforeWrite = false;
    try {
      if ((await lstat(this.file)).isSymbolicLink()) throw new Error("Journal file cannot be a symlink");
      const raw: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error("Journal must contain a record map");
      const parsed = journalSchema.safeParse(Object.entries(raw));
      if (!parsed.success) throw new Error("Journal records have an invalid shape");
      this.records = Object.assign(Object.create(null), Object.fromEntries(parsed.data));
      for (const record of Object.values(this.records)) {
        if (["queued", "preparing", "rendering", "encoding"].includes(record.state))
          record.interrupted = true;
        else delete record.interrupted;
      }
    } catch (error) {
      this.records = Object.create(null);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.loadError = {
          code: "INVALID_JOB_JOURNAL",
          message: error instanceof Error ? error.message : String(error),
          ids: [],
        };
        this.preserveBeforeWrite = true;
      }
    }
    return this.list();
  }
  list(): RecoveredJob[] {
    return structuredClone(Object.values(this.records));
  }
  record(job: RenderJobSnapshot): Promise<void> {
    const parsed = recordSchema.safeParse(job);
    if (!parsed.success) return Promise.reject(new Error("Invalid render job snapshot"));
    this.records[job.jobId] = structuredClone(parsed.data);
    const bytes = JSON.stringify(this.records);
    const persist = async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      try {
        if ((await lstat(this.file)).isSymbolicLink()) throw new Error("Journal file cannot be a symlink");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const temporary = `${this.file}.${randomUUID()}.tmp`,
        handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (this.preserveBeforeWrite) {
        try {
          await link(this.file, `${this.file}.preserved-${randomUUID()}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        this.preserveBeforeWrite = false;
      }
      await rename(temporary, this.file);
    };
    this.tail = this.tail.then(persist, persist);
    return this.tail;
  }
  flush(): Promise<void> {
    return this.tail;
  }
}
