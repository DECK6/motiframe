import { mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { writeProjectArtifact } from "../../apps/runner/src/write-artifact";
import { expectOk } from "../helpers/result";

it("rejects redirected artifact directories and preserves immutable artifacts with different bytes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motiframe-artifact-")),
    outside = await mkdtemp(path.join(os.tmpdir(), "motiframe-outside-"));
  await symlink(outside, path.join(dir, "definitions"));
  expect(await writeProjectArtifact(dir, "definitions/a.js", Buffer.from("safe"))).toMatchObject({
    ok: false,
    error: { code: "UNSAFE_ARTIFACT_PATH" },
  });
  const normal = await mkdtemp(path.join(os.tmpdir(), "motiframe-normal-"));
  expectOk(await writeProjectArtifact(normal, "definitions/a.js", Buffer.from("a")));
  expect(await writeProjectArtifact(normal, "definitions/a.js", Buffer.from("b"))).toMatchObject({
    ok: false,
    error: { code: "ARTIFACT_CONFLICT" },
  });
  expect(await readFile(path.join(normal, "definitions/a.js"), "utf8")).toBe("a");
  expect(await writeProjectArtifact(normal, "../outside.js", Buffer.from("bad"))).toMatchObject({
    ok: false,
  });
});
