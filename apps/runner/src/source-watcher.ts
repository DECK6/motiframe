import { createHash } from "node:crypto";
import { constants, type FSWatcher, watch } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import {
  buildDefinition,
  type DefinitionArtifact,
  type DefinitionSource,
} from "../../../packages/authoring/src/build";
import { reconcileDefinition } from "../../../packages/authoring/src/reconcile";
import { resolveDefinitionKey } from "../../../packages/authoring/src/revisions";
import type { DefinitionRef } from "../../../packages/document/src/definition-commands";
import type { ProjectDocument } from "../../../packages/document/src/schema";

export type SourceCandidate = {
  id: string;
  source: DefinitionSource | null;
  oldRef: DefinitionRef;
  instanceIds: string[];
  baseRevision: number;
  artifact?: DefinitionArtifact;
  diagnostics: string[];
  status: "ready" | "failed" | "migration-required";
};
export type SourceWatcher = { close(): Promise<void>; candidates(): SourceCandidate[] };
type Reference = { oldRef: DefinitionRef; instanceIds: string[] };
type SourceRead = { fingerprint: string; text?: string; problem?: string };
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function references(document: ProjectDocument): Map<string, Reference> {
  const result = new Map<string, Reference>();
  for (const [id, instance] of Object.entries(document.instances)) {
    const key = resolveDefinitionKey(document, instance.definitionId, instance.definitionRevision);
    const manifest = key ? document.definitions[key] : undefined;
    if (!manifest || !/^[a-f0-9]{64}$/.test(manifest.moduleHash)) continue;
    const name = `${manifest.moduleHash}.source.json`;
    const entry = result.get(name) ?? {
      oldRef: { definitionId: manifest.id, revision: manifest.revision },
      instanceIds: [],
    };
    entry.instanceIds.push(id);
    result.set(name, entry);
  }
  return result;
}

function parseSource(text: string): DefinitionSource | null {
  try {
    const input: unknown = JSON.parse(text);
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const value = input as Record<string, unknown>;
    if (
      !value.manifest ||
      typeof value.manifest !== "object" ||
      Array.isArray(value.manifest) ||
      !value.files ||
      typeof value.files !== "object" ||
      Array.isArray(value.files) ||
      Object.values(value.files).some((item) => typeof item !== "string") ||
      (value.entry !== undefined && typeof value.entry !== "string")
    )
      return null;
    return {
      manifest: value.manifest,
      files: value.files,
      ...(value.entry === undefined ? {} : { entry: value.entry }),
    } as DefinitionSource;
  } catch {
    return null;
  }
}

/** Observe only document-referenced, project-local source artifacts. Never writes source or project files. */
export async function watchDefinitionSources(
  projectDir: string,
  getDocument: () => ProjectDocument,
  onCandidate: (candidate: SourceCandidate) => void,
): Promise<SourceWatcher> {
  const root = await realpath(projectDir),
    directory = path.join(root, "definitions");
  const observed = new Map<string, string>(),
    latest = new Map<string, SourceCandidate>();
  let closed = false,
    generation = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  let definitionWatch: FSWatcher | undefined,
    definitionIdentity = "";
  let active: Promise<void> = Promise.resolve();

  async function directoryIdentity(): Promise<string | undefined> {
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(directory)) !== directory)
        return undefined;
      return `${stat.dev}:${stat.ino}`;
    } catch {
      return undefined;
    }
  }
  async function readSource(name: string): Promise<SourceRead> {
    if (!(await directoryIdentity())) return { fingerprint: "path-denied", problem: "SOURCE_PATH_DENIED" };
    try {
      const file = path.join(directory, name),
        stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || (await realpath(file)) !== file)
        return { fingerprint: "path-denied", problem: "SOURCE_PATH_DENIED" };
      if (stat.size > MAX_SOURCE_BYTES) return { fingerprint: "size-denied", problem: "SOURCE_TOO_LARGE" };
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          opened.size > MAX_SOURCE_BYTES ||
          opened.ino !== stat.ino ||
          opened.dev !== stat.dev
        )
          return { fingerprint: "path-denied", problem: "SOURCE_PATH_DENIED" };
        const bytes = Buffer.alloc(MAX_SOURCE_BYTES + 1);
        let count = 0;
        while (count < bytes.length) {
          const read = await handle.read(bytes, count, bytes.length - count, count);
          if (!read.bytesRead) break;
          count += read.bytesRead;
        }
        if (count > MAX_SOURCE_BYTES) return { fingerprint: "size-denied", problem: "SOURCE_TOO_LARGE" };
        if (!(await directoryIdentity()))
          return { fingerprint: "path-denied", problem: "SOURCE_PATH_DENIED" };
        const text = bytes.subarray(0, count).toString("utf8");
        return { fingerprint: sha(text), text };
      } finally {
        await handle.close();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const problem = code === "ENOENT" ? "SOURCE_UNAVAILABLE" : "SOURCE_PATH_DENIED";
      return { fingerprint: problem, problem };
    }
  }
  function schedule() {
    if (closed) return;
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      active = active
        .then(() => scan())
        .catch(() => {
          /* fs races are retried on the next event. */
        });
    }, 75);
  }
  async function attachDirectory() {
    const identity = await directoryIdentity();
    if (identity === definitionIdentity) return;
    definitionWatch?.close();
    definitionWatch = undefined;
    definitionIdentity = identity ?? "";
    if (identity && !closed) {
      try {
        definitionWatch = watch(directory, (_event, name) => {
          if (!name || references(getDocument()).has(name.toString())) schedule();
        });
        definitionWatch.on("error", () => {
          definitionWatch?.close();
          definitionIdentity = "";
          schedule();
        });
      } catch {
        definitionIdentity = "";
      }
    }
  }
  async function makeCandidate(
    document: ProjectDocument,
    ref: Reference,
    read: SourceRead,
  ): Promise<SourceCandidate> {
    const candidate: SourceCandidate = {
      id: `source-candidate:${sha(`${document.id}:${document.revision}:${ref.oldRef.definitionId}:${read.fingerprint}`)}`,
      source: null,
      ...ref,
      baseRevision: document.revision,
      diagnostics: [],
      status: "failed",
    };
    if (read.problem) {
      candidate.diagnostics.push(`${read.problem}: Referenced source is unavailable or unsafe.`);
      return candidate;
    }
    const source = parseSource(read.text ?? "");
    if (!source) {
      candidate.diagnostics.push("INVALID_SOURCE: Expected definition manifest and local source files.");
      return candidate;
    }
    if (source.manifest.revision === ref.oldRef.revision) source.manifest.revision += 1;
    candidate.source = source;
    const built = await buildDefinition(source);
    if (!built.ok) {
      // Build diagnostics can contain source text or absolute import paths; return a portable code only.
      candidate.diagnostics.push(`${built.error.code}: Definition source could not be built.`);
      if (built.error.code === "CAPABILITY_DENIED") candidate.source = null;
      return candidate;
    }
    candidate.artifact = built.value;
    const checked = reconcileDefinition(document, ref.oldRef, built.value, { instanceIds: ref.instanceIds });
    if (!checked.ok) {
      candidate.status = checked.error.code.endsWith("_MIGRATION_REQUIRED") ? "migration-required" : "failed";
      candidate.diagnostics.push(`${checked.error.code}: ${checked.error.message}`);
    } else candidate.status = "ready";
    return candidate;
  }
  async function scan() {
    if (closed) return;
    const version = generation,
      document = structuredClone(getDocument()),
      refs = references(document);
    await attachDirectory();
    for (const name of observed.keys())
      if (!refs.has(name)) {
        observed.delete(name);
        latest.delete(name);
      }
    for (const [name, ref] of refs) {
      const read = await readSource(name);
      if (closed || version !== generation) return;
      // An explicit registration adds a newly published source. Baseline that file;
      // only a subsequent external edit should propose another revision.
      if (!observed.has(name)) {
        observed.set(name, read.fingerprint);
        continue;
      }
      if (observed.get(name) === read.fingerprint) continue;
      const candidate = await makeCandidate(document, ref, read);
      if (closed || version !== generation) return;
      if (getDocument().revision !== document.revision) {
        schedule();
        return;
      }
      observed.set(name, read.fingerprint);
      latest.set(name, candidate);
      onCandidate(structuredClone(candidate));
    }
  }
  const rootWatch = watch(root, (_event, name) => {
    if (!name || name.toString() === "definitions" || name.toString().endsWith(".json")) schedule();
  });
  rootWatch.on("error", schedule);
  await attachDirectory();
  for (const name of references(getDocument()).keys())
    observed.set(name, (await readSource(name)).fingerprint);
  // Native watchers can coalesce or miss events during atomic saves or startup.
  // A bounded, project-scoped hash scan provides eventual delivery in that case.
  const poll = setInterval(() => {
    if (!closed && !timer) active = active.then(() => scan()).catch(() => {});
  }, 1000);
  return {
    async close() {
      closed = true;
      generation += 1;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      rootWatch.close();
      definitionWatch?.close();
      await active;
    },
    candidates() {
      const document = getDocument(),
        refs = references(document);
      return structuredClone(
        [...latest]
          .filter(([name, candidate]) => refs.has(name) && candidate.baseRevision === document.revision)
          .map(([, candidate]) => candidate),
      );
    },
  };
}
