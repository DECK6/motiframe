import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createOfflineDocumentStore } from "../../apps/editor/src/state/offline";
import { projectContentHash } from "../../packages/document/src/apply";
import {
  bytesToDataUrl,
  createMemoryBrowserStorage,
  exportBrowserBundle,
  importBrowserBundle,
  serializeBrowserProject,
} from "../../packages/document/src/browser-storage";
import { packProject, unpackProject } from "../../packages/document/src/bundle";
import type { EditTransaction } from "../../packages/document/src/commands";
import { createHistory } from "../../packages/document/src/history";
import { fail } from "../../packages/document/src/result";
import { createStarterProject } from "../../packages/document/src/starter";
import { expectOk } from "../helpers/result";

const transaction = (document: ReturnType<typeof createStarterProject>): EditTransaction => ({
  id: `t-${document.revision}`,
  baseRevision: document.revision,
  author: "user",
  scope: {
    instanceIds: Object.keys(document.instances),
    range: { start: 0, end: document.settings.duration },
    preserveDuration: true,
    ripple: false,
  },
  commands: [{ type: "SetProps", instanceId: "title", props: { text: "브라우저에서 이어서" } }],
});
it("recovers committed document and undo history from the same persistent storage", async () => {
  const storage = createMemoryBrowserStorage(),
    first = expectOk(await createOfflineDocumentStore({ storage })),
    original = projectContentHash(first.getDocument());
  expectOk(await first.api("transaction", { transaction: transaction(first.getDocument()) }));
  const recovered = expectOk(await createOfflineDocumentStore({ storage }));
  expect(recovered.getDocument().instances.title.props.text).toBe("브라우저에서 이어서");
  expectOk(await recovered.api("undo", {}));
  expect(projectContentHash(recovered.getDocument())).toBe(original);
  expectOk(await recovered.api("redo", {}));
  expect(recovered.getDocument().revision).toBe(3);
});
it("does not publish a mutation when durable saving fails", async () => {
  const backing = createMemoryBrowserStorage(),
    store = expectOk(
      await createOfflineDocumentStore({
        storage: { ...backing, save: async () => fail("QUOTA_EXCEEDED", "Storage is full") },
      }),
    );
  const original = store.getDocument();
  expect(await store.api("transaction", { transaction: transaction(original) })).toMatchObject({
    ok: false,
    error: { code: "QUOTA_EXCEEDED" },
  });
  expect(store.getDocument()).toEqual(original);
});
it("keeps binary assets outside document JSON and recovers font data for the stage", async () => {
  const storage = createMemoryBrowserStorage(),
    store = expectOk(await createOfflineDocumentStore({ storage }));
  const registered = expectOk(
    await store.addAsset(
      Object.assign(new Blob(["font bytes"], { type: "font/ttf" }), { name: "example.ttf" }),
      "font",
      "Example",
    ),
  );
  const exported = expectOk(store.exportProjectJson());
  expect(exported).not.toContain("data:");
  expect(exported).not.toContain("/Users/");
  const again = expectOk(await createOfflineDocumentStore({ storage }));
  expect(again.getDocument().assets[registered.assetId]).toMatchObject({ kind: "font" });
  expect(expectOk(await again.getOfflineProjectAssets()).fonts).toEqual([
    { family: "Example", url: "data:font/ttf;base64,Zm9udCBieXRlcw==" },
  ]);
});
it("round-trips a portable ZIP with validated asset hashes and no native filesystem dependencies", async () => {
  const storage = createMemoryBrowserStorage(),
    store = expectOk(await createOfflineDocumentStore({ storage }));
  expectOk(
    await store.addAsset(
      Object.assign(new Blob(["original"], { type: "image/png" }), { name: "image.png" }),
      "image",
    ),
  );
  const document = store.getDocument(),
    assets = expectOk(await storage.assets(document.id));
  const zip = expectOk(await exportBrowserBundle(document, assets));
  expect(Array.from(new Uint8Array(await zip.arrayBuffer()).slice(0, 4))).toEqual([80, 75, 3, 4]);
  const opened = expectOk(await importBrowserBundle(zip));
  expect(projectContentHash(opened.document)).toBe(projectContentHash(document));
  expect(opened.assets[0].dataUrl).toBe(assets[0].dataUrl);
  const damaged = new Uint8Array(await zip.arrayBuffer());
  damaged[45] ^= 0xff;
  expect((await importBrowserBundle(new Blob([damaged]))).ok).toBe(false);
});
it("rejects private paths, malformed imports and unsupported runner actions", async () => {
  const document = createStarterProject();
  document.assets.private = { kind: "image", logicalPath: "/Users/person/private.png", sha256: "x" };
  expect(serializeBrowserProject(document).ok).toBe(false);
  const store = expectOk(await createOfflineDocumentStore({ storage: createMemoryBrowserStorage() }));
  expect((await store.importProjectJson("{broken")).ok).toBe(false);
  expect(await store.api("render", {})).toMatchObject({ ok: false, error: { code: "RUNNER_REQUIRED" } });
  expect(store.evaluate(240000).ok).toBe(true);
  expect(await store.api("review", {})).toMatchObject({ ok: true });
});

it("rejects stored asset bytes whose metadata hash hides corruption", async () => {
  const storage = createMemoryBrowserStorage();
  const store = expectOk(await createOfflineDocumentStore({ storage }));
  const added = expectOk(
    await store.addAsset(Object.assign(new Blob(["valid"], { type: "image/png" }), { name: "image.png" })),
  );
  const document = store.getDocument();
  const assets = expectOk(await storage.assets(document.id));
  assets[0].dataUrl = bytesToDataUrl(new TextEncoder().encode("corrupt"), "image/png");
  expectOk(await storage.save(createHistory(document), assets));
  expect(await store.getAssetData(added.assetId)).toMatchObject({
    ok: false,
    error: { code: "ASSET_HASH_MISMATCH" },
  });
});
it("refuses private paths and credentials in nested project props", () => {
  const document = createStarterProject();
  document.instances.title.props.private = "/home/person/private.txt";
  expect(serializeBrowserProject(document).ok).toBe(false);
  document.instances.title.props.private = "public";
  document.instances.title.props.authorization = "secret-value";
  expect(serializeBrowserProject(document).ok).toBe(false);
});
it("rejects a ZIP whose local size conflicts with its central directory", async () => {
  const zip = expectOk(await exportBrowserBundle(createStarterProject(), []));
  const bytes = new Uint8Array(await zip.arrayBuffer());
  new DataView(bytes.buffer).setUint32(18, 1, true);
  expect((await importBrowserBundle(new Blob([bytes]))).ok).toBe(false);
});
it("exchanges the same portable format with the native runner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "motiframe-browser-bundle-"));
  const document = createStarterProject();
  const browserArchive = expectOk(await exportBrowserBundle(document, []));
  const browserPath = join(directory, "browser.motionproj");
  await writeFile(browserPath, new Uint8Array(await browserArchive.arrayBuffer()));
  const unpacked = expectOk(await unpackProject(browserPath, join(directory, "unpacked")));
  expect(projectContentHash(unpacked)).toBe(projectContentHash(document));
  const native = expectOk(
    await packProject(document, { projectDir: directory, outputPath: join(directory, "native.motionproj") }),
  );
  const imported = expectOk(await importBrowserBundle(new Blob([await readFile(native.path)])));
  expect(projectContentHash(imported.document)).toBe(projectContentHash(document));
});
