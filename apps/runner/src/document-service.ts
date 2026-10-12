import { createHash } from "node:crypto";
import { parseChangeSet, validateChangeSet } from "../../../packages/automation/src/index";
import type { EditTransaction } from "../../../packages/document/src/commands";
import {
  commitHistory,
  createHistory,
  type HistoryState,
  projectContentHash,
  redo,
  undo,
} from "../../../packages/document/src/history";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import type { ProjectDocument } from "../../../packages/document/src/schema";
export type CommitReceipt = {
  requestId: string;
  documentRevision: number;
  affectedIds: string[];
  contentHash: string;
};
export type DocumentEvent = {
  revision: number;
  requestId: string;
  affectedIds: string[];
  contentHash: string;
};
type DurableHistory = HistoryState & {
  commits?: Record<string, { inputHash: string; receipt: CommitReceipt }>;
};
const canonical = (value: unknown): string =>
  value && typeof value === "object"
    ? Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
          .join(",")}}`
    : (JSON.stringify(value) ?? "null");
const fingerprint = (tx: EditTransaction) => createHash("sha256").update(canonical(tx)).digest("hex");
export class DocumentService {
  private history: DurableHistory;
  private tail: Promise<unknown> = Promise.resolve();
  private events: DocumentEvent[] = [];
  private listeners = new Set<() => void>();
  constructor(
    document: ProjectDocument,
    public options: {
      save?: (document: ProjectDocument) => Promise<Result<void>>;
      saveHistory?: (state: DurableHistory) => Promise<Result<void>>;
      history?: DurableHistory;
    } = {},
  ) {
    this.history = options.history ?? createHistory(document);
  }
  get document() {
    return structuredClone(this.history.document);
  }
  get historyState() {
    return structuredClone(this.history);
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const task = this.tail.then(work, work);
    this.tail = task.catch(() => {});
    return task;
  }
  private async commit(
    next: Result<HistoryState>,
    requestId: string,
    affectedIds: string[],
    inputHash?: string,
  ): Promise<Result<CommitReceipt>> {
    if (!next.ok) return next;
    const contentHash = projectContentHash(next.value.document),
      documentRevision = next.value.document.revision;
    const receipt = { requestId, documentRevision, affectedIds, contentHash };
    const state: DurableHistory = {
      ...next.value,
      commits: { ...this.history.commits, ...(inputHash ? { [requestId]: { inputHash, receipt } } : {}) },
    };
    try {
      const saved = this.options.saveHistory
        ? await this.options.saveHistory(state)
        : await this.options.save?.(next.value.document);
      if (saved && !saved.ok) return saved;
    } catch (error) {
      return fail("SAVE_FAILED", String(error));
    }
    this.history = state;
    this.events.push({ revision: documentRevision, requestId, affectedIds, contentHash });
    for (const listener of this.listeners) listener();
    return ok({ requestId, documentRevision, affectedIds, contentHash });
  }
  submit(tx: EditTransaction, options: { gestureId?: string } = {}): Promise<Result<CommitReceipt>> {
    return this.enqueue(async () => {
      if (!tx || !Array.isArray(tx.commands))
        return fail("INVALID_TRANSACTION", "A transaction must contain commands");
      const replay = this.replay(tx);
      if (replay) return replay;
      const next = commitHistory(this.history, tx, options);
      if (!next.ok) return next;
      return this.commit(next, tx.id, [...tx.scope.instanceIds], fingerprint(tx));
    });
  }
  replay(tx: EditTransaction): Result<CommitReceipt> | undefined {
    if (!tx || typeof tx.id !== "string") return undefined;
    const stored = this.history.commits?.[tx.id];
    return !stored
      ? undefined
      : stored.inputHash === fingerprint(tx)
        ? ok(structuredClone(stored.receipt))
        : fail("REQUEST_ID_REUSED", "This request ID was committed with different content", [tx.id]);
  }
  async patch(input: unknown, dryRun = false): Promise<Result<unknown>> {
    const parsed = parseChangeSet(input);
    if (!parsed.ok) return parsed;
    if (!dryRun) {
      const previous = this.replay(parsed.value.transaction);
      if (previous) return previous;
    }
    const valid = validateChangeSet(this.document, parsed.value);
    return !valid.ok
      ? valid
      : dryRun
        ? ok({ transaction: valid.value, baseRevision: this.document.revision })
        : this.submit(valid.value);
  }
  undo(): Promise<Result<CommitReceipt>> {
    return this.enqueue(() =>
      this.commit(
        undo(this.history),
        `undo:${this.history.document.revision}`,
        Object.keys(this.history.document.instances),
      ),
    );
  }
  redo(): Promise<Result<CommitReceipt>> {
    return this.enqueue(() =>
      this.commit(
        redo(this.history),
        `redo:${this.history.document.revision}`,
        Object.keys(this.history.document.instances),
      ),
    );
  }
  eventsAfter(revision: number): DocumentEvent[] {
    return structuredClone(this.events.filter((e) => e.revision > revision));
  }
  async *subscribe(afterRevision: number, signal?: AbortSignal): AsyncIterable<DocumentEvent> {
    let revision = afterRevision;
    while (!signal?.aborted) {
      const events = this.eventsAfter(revision);
      if (events.length) {
        for (const event of events) {
          revision = event.revision;
          yield event;
        }
        continue;
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          this.listeners.delete(done);
          signal?.removeEventListener("abort", done);
          resolve();
        };
        this.listeners.add(done);
        signal?.addEventListener("abort", done, { once: true });
        if (this.eventsAfter(revision).length || signal?.aborted) done();
      });
    }
  }
}
