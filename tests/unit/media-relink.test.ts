import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { inspectAssetFiles, relinkAsset } from "../../apps/runner/src/relink-asset";
import type { ProjectDocument } from "../../packages/document/src/schema";

const bytes = Buffer.from("original media bytes"),
  sha256 = createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const projectDir = path.resolve(`artifacts/relink-tests/${crypto.randomUUID()}`);
  await mkdir(projectDir, { recursive: true });
  const document = {
    assets: { original: { kind: "image", sha256, logicalPath: "assets/original.png" } },
  } as unknown as ProjectDocument;
  return { projectDir, document };
}
it("reports missing files and restores only the original asset bytes and ID", async () => {
  const { projectDir, document } = await fixture(),
    before = structuredClone(document);
  expect(await inspectAssetFiles(document, { projectDir })).toMatchObject({
    ok: true,
    value: { original: { status: "missing", missing: true } },
  });
  expect(await relinkAsset(document, "original", { projectDir, bytes })).toMatchObject({
    ok: true,
    value: { assetId: "original", restored: true, asset: document.assets.original },
  });
  expect(await readFile(path.join(projectDir, "assets/original.png"))).toEqual(bytes);
  expect(document).toEqual(before);
  expect(await inspectAssetFiles(document, { projectDir })).toMatchObject({
    ok: true,
    value: { original: { status: "available", missing: false } },
  });
  expect(await relinkAsset(document, "original", { projectDir, bytes })).toMatchObject({
    ok: true,
    value: { restored: false },
  });
});
it("rejects unknown IDs and mismatched uploads without creating any file or changing metadata", async () => {
  const { projectDir, document } = await fixture(),
    before = structuredClone(document);
  expect(await relinkAsset(document, "unregistered", { projectDir, bytes })).toMatchObject({
    ok: false,
    error: { code: "UNKNOWN_ASSET" },
  });
  expect(
    await relinkAsset(document, "original", { projectDir, bytes: Buffer.from("different bytes") }),
  ).toMatchObject({ ok: false, error: { code: "ASSET_HASH_MISMATCH" } });
  expect(await readdir(projectDir)).toEqual([]);
  expect(document).toEqual(before);
});
it("preserves changed files in a backup while restoring their registered bytes", async () => {
  const { projectDir, document } = await fixture();
  await mkdir(path.join(projectDir, "assets"));
  await writeFile(path.join(projectDir, "assets/original.png"), "changed bytes");
  expect(await inspectAssetFiles(document, { projectDir })).toMatchObject({
    ok: true,
    value: { original: { status: "hash-mismatch" } },
  });
  expect(await relinkAsset(document, "original", { projectDir, bytes })).toMatchObject({ ok: true });
  const backups = await readdir(path.join(projectDir, "assets/relink-backups"));
  expect(backups).toHaveLength(1);
  expect(await readFile(path.join(projectDir, "assets/relink-backups", backups[0]), "utf8")).toBe(
    "changed bytes",
  );
  expect(await readFile(path.join(projectDir, "assets/original.png"))).toEqual(bytes);
});
it("rejects path escapes and symlinked asset folders without writing outside the project", async () => {
  const { projectDir, document } = await fixture(),
    outside = path.resolve(`artifacts/relink-tests/outside-${crypto.randomUUID()}`);
  await mkdir(outside, { recursive: true });
  await symlink(outside, path.join(projectDir, "assets"), "dir");
  expect(await relinkAsset(document, "original", { projectDir, bytes })).toMatchObject({
    ok: false,
    error: { code: "ASSET_PATH_DENIED" },
  });
  expect(await readdir(outside)).toEqual([]);
  document.assets.original = { sha256, logicalPath: "assets/../../escape.png" };
  expect(await relinkAsset(document, "original", { projectDir, bytes })).toMatchObject({
    ok: false,
    error: { code: "ASSET_PATH_DENIED" },
  });
});
it("does not mutate files when already cancelled", async () => {
  const { projectDir, document } = await fixture(),
    abort = new AbortController();
  abort.abort();
  expect(await relinkAsset(document, "original", { projectDir, bytes, signal: abort.signal })).toMatchObject({
    ok: false,
    error: { code: "CANCELLED" },
  });
  expect(await readdir(projectDir)).toEqual([]);
});
