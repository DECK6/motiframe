import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { acquireWriter } from "../../apps/runner/src/project-storage";
import { expectOk } from "../helpers/result";

it("allows only one project writer and releases for the next writer", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "motiframe-lock-"));
  const file = path.join(folder, "project.json");
  const first = expectOk(await acquireWriter(file));
  try {
    const second = await acquireWriter(file);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("WRITER_ACTIVE");
    await first.publish("http://127.0.0.1:4173");
    const record = JSON.parse(await readFile(first.path, "utf8"));
    expect(record.endpoint).toBe("http://127.0.0.1:4173");
    expect(record.token).toBe(first.token);
  } finally {
    await first.close();
  }
  const next = expectOk(await acquireWriter(file));
  await next.close();
});
