import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { JobJournal } from "../../apps/runner/src/job-journal";
import type { RenderJobSnapshot } from "../../apps/runner/src/jobs";
import { recoverProject, restoreSnapshot } from "../../packages/document/src/recovery";
import { createStarterProject } from "../../packages/document/src/starter";
import { expectOk } from "../helpers/result";

const workspace = () => mkdtemp(join(tmpdir(), "motiframe-recovery-hardening-"));
const snapshot = async (file: string, revision = 2) => {
  const document = createStarterProject();
  document.revision = revision;
  const bytes = JSON.stringify(document);
  const name = `${revision}-${createHash("sha256").update(bytes).digest("hex")}.json`;
  await mkdir(`${file}.snapshots`, { recursive: true });
  await writeFile(join(`${file}.snapshots`, name), bytes);
  return { name, document, bytes };
};
it("checks snapshot filename revision and byte digest before offering or restoring it", async () => {
  const file = join(await workspace(), "project.json");
  await writeFile(file, "corrupt original");
  const saved = await snapshot(file);
  const renamed = saved.name.replace(/^2-/, "99-");
  await rename(join(`${file}.snapshots`, saved.name), join(`${file}.snapshots`, renamed));
  expect(expectOk(await recoverProject(file)).candidates).toEqual([]);
  expect(await restoreSnapshot(file, renamed)).toMatchObject({
    ok: false,
    error: { code: "SNAPSHOT_MISMATCH" },
  });
  expect(await readFile(file, "utf8")).toBe("corrupt original");
  await rename(join(`${file}.snapshots`, renamed), join(`${file}.snapshots`, saved.name));
  await writeFile(
    join(`${file}.snapshots`, saved.name),
    JSON.stringify({ ...saved.document, id: "tampered" }),
  );
  expect(await restoreSnapshot(file, saved.name)).toMatchObject({
    ok: false,
    error: { code: "SNAPSHOT_MISMATCH" },
  });
});
it("rejects symlink snapshots and snapshot directories without touching external files", async () => {
  const directory = await workspace(),
    file = join(directory, "project.json");
  const saved = await snapshot(file);
  await writeFile(file, "broken");
  const external = join(directory, "outside.json");
  await rename(join(`${file}.snapshots`, saved.name), external);
  await symlink(external, join(`${file}.snapshots`, saved.name));
  expect(await restoreSnapshot(file, saved.name)).toMatchObject({
    ok: false,
    error: { code: "INVALID_RECOVERY_PATH" },
  });
  expect(expectOk(await recoverProject(file)).candidates).toEqual([]);
  await rename(`${file}.snapshots`, join(directory, "original-snapshots"));
  await symlink(join(directory, "original-snapshots"), `${file}.snapshots`);
  expect(await restoreSnapshot(file, saved.name)).toMatchObject({
    ok: false,
    error: { code: "INVALID_RECOVERY_PATH" },
  });
  expect(await readFile(external, "utf8")).toBe(saved.bytes);
  expect(await readFile(file, "utf8")).toBe("broken");
});
it("never automatically restores and preserves the corrupt original on explicit restore", async () => {
  const directory = await workspace(),
    file = join(directory, "project.json"),
    saved = await snapshot(file);
  await writeFile(file, "broken original");
  const report = expectOk(await recoverProject(file));
  expect(report.requiresChoice).toBe(true);
  expect(report.candidates.map((c) => c.file)).toEqual([saved.name]);
  expect(await readFile(file, "utf8")).toBe("broken original");
  expect(expectOk(await restoreSnapshot(file, saved.name))).toEqual(saved.document);
  const preserved = (await readdir(directory)).filter((name) => name.startsWith("project.json.preserved-"));
  expect(preserved).toHaveLength(1);
  expect(await readFile(join(directory, preserved[0]), "utf8")).toBe("broken original");
});
const job = (jobId: string, state: RenderJobSnapshot["state"] = "rendering"): RenderJobSnapshot => ({
  jobId,
  revision: 1,
  state,
  progress: { completed: 2, total: 10 },
});
it("recovers interrupted jobs and rejects malformed journal records", async () => {
  const file = join(await workspace(), "jobs.json");
  await writeFile(file, JSON.stringify({ a: job("a"), b: job("b", "failed") }));
  const journal = new JobJournal(file);
  const jobs = await journal.load();
  expect(jobs.find((j) => j.jobId === "a")?.interrupted).toBe(true);
  expect(jobs.find((j) => j.jobId === "b")?.interrupted).not.toBe(true);
  const corrupt = JSON.stringify({
    bad: { jobId: "bad", state: "completed", revision: -1, progress: { completed: "10", total: 0 } },
  });
  await writeFile(file, corrupt);
  expect(await journal.load()).toEqual([]);
  expect(journal.loadError?.code).toBe("INVALID_JOB_JOURNAL");
  await journal.record(job("valid"));
  const preserved = (await readdir(join(file, ".."))).find((n) => n.startsWith("jobs.json.preserved-"));
  expect(preserved).toBeDefined();
  expect(await readFile(join(file, "..", preserved!), "utf8")).toBe(corrupt);
});
it("persists later writes after a failed journal write", async () => {
  const directory = await workspace(),
    blocker = join(directory, "blocked");
  await writeFile(blocker, "occupied");
  const journal = new JobJournal(join(blocker, "jobs.json"));
  await expect(journal.record(job("first"))).rejects.toThrow();
  await rename(blocker, join(directory, "preserved-blocker"));
  await journal.record(job("second", "cancelled"));
  await journal.flush();
  const loaded = await new JobJournal(join(blocker, "jobs.json")).load();
  expect(loaded.map((j) => j.jobId).sort()).toEqual(["first", "second"]);
});
it("retains job IDs that overlap ordinary object property names", async () => {
  const journal = new JobJournal(join(await workspace(), "jobs.json"));
  await journal.record(job("__proto__"));
  expect(journal.list().map((record) => record.jobId)).toEqual(["__proto__"]);
  expect((await journal.load()).map((record) => record.jobId)).toEqual(["__proto__"]);
});
