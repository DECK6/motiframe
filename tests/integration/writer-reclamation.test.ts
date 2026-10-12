import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { acquireWriter } from "../../apps/runner/src/project-storage";
import { expectOk } from "../helpers/result";

const race = vi.hoisted(() => ({
  enabled: false,
  lock: "",
  reads: 0,
  renames: 0,
  readBarrier: Promise.resolve(),
  winner: Promise.resolve(),
  releaseReads: () => {},
  releaseWinner: () => {},
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      const bytes = await fs.readFile(...args);
      if (race.enabled && String(args[0]) === race.lock && race.reads < 2) {
        race.reads++;
        if (race.reads === 2) race.releaseReads();
        await race.readBarrier;
      }
      return bytes;
    },
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (race.enabled && String(args[0]) === race.lock && ++race.renames === 2) await race.winner;
      return fs.rename(...args);
    },
  };
});
afterEach(() => {
  race.enabled = false;
  race.releaseReads();
  race.releaseWinner();
});
async function staleWriter() {
  const directory = await mkdtemp(join(tmpdir(), "motiframe-writer-race-")),
    file = join(directory, "project.json");
  await writeFile(file, "{}");
  const lease = expectOk(await acquireWriter(file));
  await lease.close();
  const child = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
  expect(child.status).toBe(0);
  const record = { pid: child.pid, token: "dead-writer", file, started: "2020-01-01T00:00:00.000Z" };
  const bytes = JSON.stringify(record);
  await writeFile(lease.path, bytes);
  return {
    file,
    lock: lease.path,
    bytes,
    pid: child.pid,
    claim: `${lease.path}.reclaim-${createHash("sha256").update(bytes).digest("hex")}`,
  };
}
it("allows exactly one winner when a second stale rename resumes after the first acquires", async () => {
  const fixture = await staleWriter();
  race.lock = fixture.lock;
  race.reads = 0;
  race.renames = 0;
  race.readBarrier = new Promise((resolve) => {
    race.releaseReads = resolve;
  });
  race.winner = new Promise((resolve) => {
    race.releaseWinner = resolve;
  });
  race.enabled = true;
  const acquire = () =>
    acquireWriter(fixture.file).then((result) => {
      if (result.ok) race.releaseWinner();
      return result;
    });
  const results = await Promise.all([acquire(), acquire()]);
  race.enabled = false;
  const winners = results.filter((result) => result.ok);
  try {
    expect(winners).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({
      ok: false,
      error: { code: "WRITER_ACTIVE" },
    });
    expect(JSON.parse(await readFile(fixture.lock, "utf8")).token).toBe(
      winners[0].ok ? winners[0].value.token : "",
    );
  } finally {
    for (const result of winners) if (result.ok) await result.value.close();
  }
  const next = expectOk(await acquireWriter(fixture.file));
  await next.close();
});
it("recovers a dead immutable reclamation claim without replacing that claim", async () => {
  const fixture = await staleWriter(),
    claim = JSON.stringify({ pid: fixture.pid, token: "dead-reclaimer" });
  await writeFile(fixture.claim, claim, { flag: "wx" });
  const recovered = expectOk(await acquireWriter(fixture.file));
  try {
    expect(await readFile(fixture.claim, "utf8")).toBe(claim);
    expect(JSON.parse(await readFile(fixture.lock, "utf8")).token).toBe(recovered.token);
  } finally {
    await recovered.close();
  }
});
it("respects an active reclamation claim and can advance its completed immutable marker", async () => {
  const fixture = await staleWriter(),
    claim = JSON.stringify({ pid: process.pid, token: "live-reclaimer" });
  await writeFile(fixture.claim, claim, { flag: "wx" });
  expect(await acquireWriter(fixture.file)).toMatchObject({ ok: false, error: { code: "WRITER_ACTIVE" } });
  expect(await readFile(fixture.lock, "utf8")).toBe(fixture.bytes);
  await writeFile(`${fixture.claim}.complete`, claim, { flag: "wx" });
  const next = expectOk(await acquireWriter(fixture.file));
  await next.close();
  expect(await readFile(fixture.claim, "utf8")).toBe(claim);
});

it("does not skip a live successor while recovering a dead claim", async () => {
  const fixture = await staleWriter(),
    deadToken = "dead-chain-owner";
  await writeFile(fixture.claim, JSON.stringify({ pid: fixture.pid, token: deadToken }), { flag: "wx" });
  const staleHash = createHash("sha256").update(fixture.bytes).digest("hex");
  const successor = `${fixture.lock}.reclaim-${createHash("sha256").update(`${staleHash}:${deadToken}`).digest("hex")}`;
  await writeFile(successor, JSON.stringify({ pid: process.pid, token: "active-successor" }), { flag: "wx" });
  expect(await acquireWriter(fixture.file)).toMatchObject({ ok: false, error: { code: "WRITER_ACTIVE" } });
  expect(await readFile(fixture.lock, "utf8")).toBe(fixture.bytes);
});
