import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type HistoryState, projectContentHash } from "../../../packages/document/src/history";
import { loadProject, saveProject } from "../../../packages/document/src/persistence";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import { DocumentService } from "./document-service";
export type WriterLease = {
  token: string;
  path: string;
  publish: (endpoint: string) => Promise<void>;
  close: () => Promise<void>;
};
export type WriterRecord = { pid: number; token: string; file: string; endpoint?: string; started: string };
export async function projectStatePaths(file: string) {
  const canonical = await realpath(file),
    key = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  const directory = path.join(path.dirname(canonical), ".motiframe", `state-${key}`);
  return {
    directory,
    history: path.join(directory, "history.json"),
    journal: path.join(directory, "journal.json"),
    jobs: path.join(directory, "jobs.json"),
  };
}
async function lockPath(file: string) {
  const parent = await realpath(path.dirname(path.resolve(file)));
  const canonical = await realpath(file).catch(() => path.join(parent, path.basename(file)));
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return path.join(parent, ".motiframe", `writer-${hash}.json`);
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
type ReclamationClaim = { pid: number; token: string };
function validClaim(value: unknown): value is ReclamationClaim {
  return (
    !!value &&
    typeof value === "object" &&
    Number.isSafeInteger((value as ReclamationClaim).pid) &&
    (value as ReclamationClaim).pid > 0 &&
    typeof (value as ReclamationClaim).token === "string" &&
    (value as ReclamationClaim).token.length > 0
  );
}
/** Claims are immutable: a dead owner is succeeded through a new exclusive link, never by renaming its guard. */
async function claimReclamation(
  lock: string,
  staleBytes: string,
): Promise<Result<{ complete: () => Promise<void> }>> {
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const staleHash = digest(staleBytes),
    token = randomUUID(),
    record = { pid: process.pid, token };
  const prepared = `${lock}.reclaim-record-${token}`,
    handle = await open(prepared, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(record));
    await handle.sync();
  } finally {
    await handle.close();
  }
  let claim = `${lock}.reclaim-${staleHash}`;
  const visited = new Set<string>();
  for (let attempt = 0; attempt < 256; attempt++) {
    if (visited.has(claim)) return fail("WRITER_ACTIVE", "Reclamation claim chain is inconsistent");
    visited.add(claim);
    try {
      // An exclusive hard link publishes the fully written claim atomically; readers never see a partial owner.
      await link(prepared, claim);
      const owned = claim;
      return ok({
        complete: async () => {
          await link(prepared, `${owned}.complete`);
        },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let previous: unknown;
    try {
      previous = JSON.parse(await readFile(claim, "utf8"));
    } catch {
      return fail("WRITER_ACTIVE", "Another writer is reclaiming the project");
    }
    if (!validClaim(previous)) return fail("WRITER_ACTIVE", "Reclamation claim needs recovery");
    let completed = false;
    try {
      const marker: unknown = JSON.parse(await readFile(`${claim}.complete`, "utf8"));
      completed = validClaim(marker) && marker.token === previous.token && marker.pid === previous.pid;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        return fail("WRITER_ACTIVE", "Reclamation completion marker needs recovery");
    }
    if (!completed && alive(previous.pid))
      return fail("WRITER_ACTIVE", "Another live writer is reclaiming the project");
    claim = `${lock}.reclaim-${digest(`${staleHash}:${previous.token}`)}`;
  }
  return fail("WRITER_ACTIVE", "Reclamation claim chain is too long; inspect recovery records");
}
export async function readWriter(file: string): Promise<WriterRecord | undefined> {
  try {
    return JSON.parse(await readFile(await lockPath(file), "utf8"));
  } catch {
    return undefined;
  }
}
export async function acquireWriter(file: string): Promise<Result<WriterLease>> {
  try {
    const p = await lockPath(file);
    await mkdir(path.dirname(p), { recursive: true });
    const token = randomUUID();
    const record: WriterRecord = {
      pid: process.pid,
      token,
      file: path.resolve(file),
      started: new Date().toISOString(),
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const handle = await open(p, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify(record));
          await handle.sync();
        } finally {
          await handle.close();
        }
        let closed = false;
        return ok({
          token,
          path: p,
          publish: async (endpoint) => {
            record.endpoint = endpoint;
            const temp = `${p}.${token}.tmp`;
            await writeFile(temp, JSON.stringify(record), { mode: 0o600 });
            await rename(temp, p);
          },
          close: async () => {
            if (closed) return;
            closed = true;
            const current = JSON.parse(await readFile(p, "utf8"));
            if (current.token === token) await rename(p, `${p}.closed-${token}`);
          },
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let previous: WriterRecord, previousBytes: string;
        try {
          previousBytes = await readFile(p, "utf8");
          previous = JSON.parse(previousBytes);
        } catch {
          return fail("WRITER_ACTIVE", "Another writer is acquiring the project");
        }
        if (!validClaim(previous)) return fail("WRITER_ACTIVE", "Writer record needs recovery");
        if (alive(previous.pid)) return fail("WRITER_ACTIVE", "Project already has a live writer");
        const claim = await claimReclamation(p, previousBytes);
        if (!claim.ok) return claim;
        try {
          let current: string;
          try {
            current = await readFile(p, "utf8");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              return fail("WRITER_ACTIVE", "Writer changed during reclamation; retry");
            throw error;
          }
          if (current !== previousBytes || alive(previous.pid))
            return fail("WRITER_ACTIVE", "Writer changed during reclamation; retry");
          await rename(p, `${p}.stale-${token}`);
        } finally {
          await claim.value.complete();
        }
      }
    }
    return fail("WRITER_ACTIVE", "Concurrent writer acquisition; retry");
  } catch (error) {
    return fail("WRITER_IO", String(error));
  }
}
export async function openDocumentService(file: string): Promise<Result<DocumentService>> {
  const loaded = await loadProject(file);
  if (!loaded.ok) return loaded;
  const paths = await projectStatePaths(file),
    dir = paths.directory;
  await mkdir(dir, { recursive: true });
  const historyPath = paths.history,
    journalPath = paths.journal;
  let history: HistoryState | undefined;
  for (const p of [
    path.join(path.dirname(dir), "history.json"),
    path.join(path.dirname(dir), "journal.json"),
    historyPath,
    journalPath,
  ])
    try {
      const candidate = JSON.parse(await readFile(p, "utf8")) as HistoryState;
      if (
        candidate.document.revision === loaded.value.revision &&
        projectContentHash(candidate.document) === projectContentHash(loaded.value)
      )
        history = candidate;
    } catch {}
  return ok(
    new DocumentService(loaded.value, {
      history,
      saveHistory: async (state) => {
        try {
          const temp = `${journalPath}.${randomUUID()}.tmp`;
          const h = await open(temp, "wx", 0o600);
          try {
            await h.writeFile(JSON.stringify(state));
            await h.sync();
          } finally {
            await h.close();
          }
          await rename(temp, journalPath);
          const saved = await saveProject(state.document, file);
          if (!saved.ok) return saved;
          // A matching prepared journal can recover undo even if interruption precedes this rename.
          await rename(journalPath, historyPath).catch(() => {});
          return ok(undefined);
        } catch (error) {
          return fail("SAVE_FAILED", String(error));
        }
      },
    }),
  );
}
