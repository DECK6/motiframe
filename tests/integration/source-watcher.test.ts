import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type SourceCandidate, watchDefinitionSources } from "../../apps/runner/src/source-watcher";
import { buildDefinition, type DefinitionSource } from "../../packages/authoring/src/build";
import type { ProjectDocument } from "../../packages/document/src/schema";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "motiframe-watch-"));
  const document: ProjectDocument = JSON.parse(
    readFileSync("tests/fixtures/mixed-static/project.json", "utf8"),
  );
  const source: DefinitionSource = {
    manifest: { ...document.definitions.red, moduleHash: "" },
    files: {
      "index.ts":
        "import { defineHtmlElement } from '@motiframe/authoring'; export default defineHtmlElement({}, {html:'original',css:''});",
    },
  };
  const built = await buildDefinition(source);
  if (!built.ok) throw new Error(built.error.message);
  document.definitions.red = built.value.manifest;
  await mkdir(path.join(directory, "definitions"));
  const file = path.join(directory, "definitions", `${built.value.moduleHash}.source.json`);
  await writeFile(file, JSON.stringify(source));
  await writeFile(path.join(directory, built.value.bundlePath), built.value.code);
  const events: SourceCandidate[] = [];
  const watcher = await watchDefinitionSources(
    directory,
    () => document,
    (candidate) => events.push(candidate),
  );
  closers.push(watcher.close);
  return { directory, document, source, file, events, watcher };
}
async function until(condition: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for a source candidate");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const changed = (source: DefinitionSource, text: string): DefinitionSource => ({
  ...source,
  files: { "index.ts": `export default {html:${JSON.stringify(text)}};` },
});

describe("external definition source candidates", () => {
  it("debounces referenced source edits, builds the next revision and leaves live files untouched", async () => {
    const f = await fixture(),
      original = structuredClone(f.document);
    expect(f.watcher.candidates()).toEqual([]);
    await writeFile(f.file, JSON.stringify(changed(f.source, "intermediate")));
    const finalSource = changed(f.source, "외부 편집");
    await writeFile(f.file, JSON.stringify(finalSource));
    await until(() => f.events.length > 0);
    const candidate = f.watcher.candidates()[0];
    expect(f.events).toHaveLength(1);
    expect(candidate).toMatchObject({
      source: { manifest: { id: "red", revision: 2 } },
      oldRef: { definitionId: "red", revision: 1 },
      instanceIds: ["red"],
      baseRevision: 0,
      status: "ready",
      diagnostics: [],
    });
    expect(candidate.artifact?.code).toContain('registerDefinition("red@2"');
    expect(candidate.artifact?.moduleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(f.document).toEqual(original);
    expect(JSON.parse(await readFile(f.file, "utf8"))).toEqual(finalSource);
    candidate.source!.manifest.revision = 99;
    expect(f.watcher.candidates()[0].source?.manifest.revision).toBe(2);
  });

  it("reports broken JSON and denied imports without exposing private paths", async () => {
    const f = await fixture();
    await writeFile(f.file, "{");
    await until(() => f.events.length === 1);
    expect(f.events[0]).toMatchObject({ status: "failed", source: null });
    expect(f.events[0].diagnostics.join(" ")).toContain("INVALID_SOURCE");
    await writeFile(
      f.file,
      JSON.stringify({
        ...f.source,
        files: { "index.ts": "import fs from '/Users/private/secrets'; export default fs;" },
      }),
    );
    await until(() => f.events.length === 2);
    expect(f.events[1].status).toBe("failed");
    expect(f.events[1].diagnostics.join(" ")).toContain("CAPABILITY_DENIED");
    expect(f.events[1].diagnostics.join(" ")).not.toContain("/Users/private");
    expect(f.document.revision).toBe(0);
  });

  it("keeps target removal as a migration candidate and respects locks", async () => {
    const f = await fixture();
    await writeFile(f.file, JSON.stringify({ ...f.source, manifest: { ...f.source.manifest, targets: [] } }));
    await until(() => f.events.length === 1);
    expect(f.events[0]).toMatchObject({
      status: "migration-required",
      artifact: { manifest: { targets: [] } },
    });
    expect(f.events[0].diagnostics.join(" ")).toContain("TARGET_MIGRATION_REQUIRED");
    f.document.instances.red.locked = true;
    await writeFile(f.file, JSON.stringify(changed(f.source, "locked")));
    await until(() => f.events.length === 2);
    expect(f.events[1]).toMatchObject({ status: "failed" });
    expect(f.events[1].diagnostics.join(" ")).toContain("LOCKED");
    expect(f.document.channels["red:root:x"].target.targetKey).toBe("root");
  });

  it("ignores unreferenced source files and stops delivering events after close", async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.directory, "definitions", `${"b".repeat(64)}.source.json`),
      JSON.stringify(changed(f.source, "unreferenced")),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(f.events).toEqual([]);
    await f.watcher.close();
    await writeFile(f.file, JSON.stringify(changed(f.source, "closed")));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(f.events).toEqual([]);
  });

  it("baselines newly published references before observing subsequent edits", async () => {
    const f = await fixture();
    const published = changed(f.source, "published by explicit apply");
    published.manifest = { ...published.manifest, revision: 2 };
    const built = await buildDefinition(published);
    if (!built.ok) throw new Error(built.error.message);
    const nextFile = path.join(f.directory, "definitions", `${built.value.moduleHash}.source.json`);
    f.document.definitions.red = built.value.manifest;
    f.document.instances.red.definitionRevision = 2;
    f.document.revision = 1;
    await writeFile(nextFile, JSON.stringify(published));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(f.events).toEqual([]);
    await writeFile(nextFile, JSON.stringify(changed(published, "external edit after apply")));
    await until(() => f.events.length === 1);
    expect(f.events[0]).toMatchObject({
      status: "ready",
      baseRevision: 1,
      oldRef: { definitionId: "red", revision: 2 },
      source: { manifest: { revision: 3 } },
    });
  });

  it("does not read a source symlink or serve candidates after their base revision changes", async () => {
    const f = await fixture();
    await writeFile(f.file, JSON.stringify(changed(f.source, "ready")));
    await until(() => f.events.length === 1);
    f.document.revision += 1;
    expect(f.watcher.candidates()).toEqual([]);
    const external = path.join(f.directory, "private-source.json");
    await writeFile(external, JSON.stringify(changed(f.source, "private")));
    // Rename preserves the user's original source and allows an adversarial symlink fixture.
    const { rename } = await import("node:fs/promises");
    await rename(f.file, `${f.file}.saved`);
    await symlink(external, f.file);
    await until(() => f.events.length === 2);
    expect(f.events[1]).toMatchObject({ status: "failed", source: null, baseRevision: 1 });
    expect(f.events[1].diagnostics.join(" ")).toContain("SOURCE_PATH_DENIED");
  });
});
