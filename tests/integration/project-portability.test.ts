import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, open, readdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { packProject, unpackProject } from "../../packages/document/src/bundle";
import { loadProject, saveProject } from "../../packages/document/src/persistence";
import type { ProjectDocument } from "../../packages/document/src/schema";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const fixture = async () =>
  JSON.parse(await readFile("tests/fixtures/mixed-static/project.json", "utf8")) as ProjectDocument;
const temporary = () => mkdtemp(join(tmpdir(), "motiframe-portability-"));
async function archive(file: string, entries: { name: string; data: string; symlink?: boolean }[]) {
  const script =
    "import sys,json,zipfile\nx=json.load(sys.stdin)\nwith zipfile.ZipFile(x['path'],'w',zipfile.ZIP_DEFLATED) as z:\n for e in x['entries']:\n  i=zipfile.ZipInfo(e['name']); i.create_system=3; i.external_attr=((0o120777 if e.get('symlink') else 0o100600)<<16); i.compress_type=zipfile.ZIP_DEFLATED; z.writestr(i,e['data'])";
  const result = spawnSync("python3", ["-c", script], {
    input: JSON.stringify({ path: file, entries }),
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
}

function manifest(entries: { name: string; data: string }[]) {
  return JSON.stringify({
    schemaVersion: 1,
    mode: "embedded",
    files: entries.map((entry) => ({
      path: entry.name,
      size: Buffer.byteLength(entry.data),
      sha256: sha(entry.data),
      role: entry.name === "project.json" ? "project" : "asset",
    })),
    externalReferences: [],
  });
}

describe("atomic project persistence", () => {
  it("handles Windows unsupported directory fsync without hiding file or Unix IO errors", async () => {
    const dir = await temporary(),
      file = join(dir, "windows.json"),
      doc = await fixture();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    let code = "EPERM",
      fileSyncs = 0;
    vi.mocked(open).mockImplementation(async (name, flags, mode) => {
      if (String(name) === dir) throw Object.assign(new Error("Directory flush unsupported"), { code });
      const handle = await actual.open(name, flags, mode);
      if (String(name).endsWith(".tmp")) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          fileSyncs += 1;
          await sync();
        };
      }
      return handle;
    });
    try {
      Object.defineProperty(process, "platform", { ...platform, value: "win32" });
      expect(await saveProject(doc, file)).toEqual({ ok: true, value: undefined });
      expect(await loadProject(file)).toEqual({ ok: true, value: doc });
      expect(fileSyncs).toBe(1);
      code = "EIO";
      expect(await saveProject(doc, join(dir, "disk-error.json"))).toMatchObject({
        ok: false,
        error: { code: "PROJECT_IO" },
      });
      code = "EPERM";
      Object.defineProperty(process, "platform", { ...platform, value: "linux" });
      expect(await saveProject(doc, join(dir, "unix-error.json"))).toMatchObject({
        ok: false,
        error: { code: "PROJECT_IO" },
      });
    } finally {
      Object.defineProperty(process, "platform", platform);
      vi.mocked(open).mockImplementation(actual.open);
    }
  });

  it("validates a temporary save and preserves a previous snapshot", async () => {
    const dir = await temporary(),
      file = join(dir, "한글 project.json"),
      doc = await fixture();
    expect(await saveProject(doc, file)).toEqual({ ok: true, value: undefined });
    const next = structuredClone(doc);
    next.revision += 1;
    expect((await saveProject(next, file)).ok).toBe(true);
    expect(await loadProject(file)).toEqual({ ok: true, value: next });
    const snapshots = await readdir(`${file}.snapshots`);
    expect(snapshots.length).toBe(1);
    expect(JSON.parse(await readFile(join(`${file}.snapshots`, snapshots[0]), "utf8"))).toEqual(doc);
    await writeFile(join(dir, ".interrupted.tmp"), '{"partial":');
    expect(await loadProject(file)).toEqual({ ok: true, value: next });
    expect((await saveProject({ ...doc, settings: { ...doc.settings, duration: -1 } }, file)).ok).toBe(false);
    expect(await loadProject(file)).toEqual({ ok: true, value: next });
  });

  it("keeps the old file valid when the writer process is killed during its temporary write", async () => {
    const dir = await temporary(),
      file = join(dir, "project.json"),
      doc = await fixture();
    expect((await saveProject(doc, file)).ok).toBe(true);
    const script = `import {readFileSync} from 'node:fs';import {saveProject} from ${JSON.stringify(resolve("packages/document/src/persistence.ts"))};const d=JSON.parse(readFileSync(${JSON.stringify(file)},'utf8'));d.revision++;d.instances[Object.keys(d.instances)[0]].props.crashProbe='x'.repeat(64*1024*1024);await saveProject(d,${JSON.stringify(file)});`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
      stdio: "ignore",
    });
    const exited = new Promise<void>((done) => child.once("exit", () => done()));
    const deadline = Date.now() + 10000;
    let interrupted = false;
    while (Date.now() < deadline && child.exitCode === null) {
      if ((await readdir(dir)).some((name) => name.endsWith(".tmp"))) {
        child.kill("SIGKILL");
        interrupted = true;
        break;
      }
      await setTimeout(2);
    }
    if (!interrupted) child.kill("SIGKILL");
    await exited;
    expect(interrupted).toBe(true);
    expect(await loadProject(file)).toEqual({ ok: true, value: doc });
  });
});

describe("portable .motionproj bundles", () => {
  it("reopens after relocation with Korean names, exact asset bytes and PTS metadata", async () => {
    const dir = await temporary(),
      doc = await fixture(),
      image = Buffer.from("local image fixture");
    await writeFile(join(dir, "한글 사진.png"), image);
    doc.assets.sample = {
      kind: "image",
      logicalPath: "한글 사진.png",
      sha256: sha(image),
      mediaMetadata: { framePts: [0, 0.041, 0.083], rotation: 90 },
    };
    const output = join(dir, "project.motionproj");
    const packed = await packProject(doc, { projectDir: dir, outputPath: output });
    expect(packed.ok).toBe(true);
    const moved = join(await temporary(), "moved.motionproj");
    await rename(output, moved);
    const dest = join(await temporary(), "reopened");
    expect(await unpackProject(moved, dest)).toEqual({ ok: true, value: doc });
    expect(await readFile(join(dest, "한글 사진.png"))).toEqual(image);
    expect(JSON.parse(await readFile(join(dest, "project.json"), "utf8"))).toEqual(doc);
    expect((await readFile(moved)).subarray(0, 4).toString("hex")).toBe("504b0304");
  });

  it("refuses missing font assets, case collisions and source symlinks", async () => {
    const dir = await temporary(),
      doc = await fixture();
    doc.assets.font = { kind: "font", logicalPath: "Missing.ttf", sha256: sha("font") };
    expect(
      await packProject(doc, { projectDir: dir, outputPath: join(dir, "missing.motionproj") }),
    ).toMatchObject({ ok: false, error: { code: "MISSING_ASSET" } });
    const references = await packProject(doc, {
      projectDir: dir,
      outputPath: join(dir, "references.motionproj"),
      mode: "references",
    });
    expect(references.ok).toBe(true);
    if (references.ok)
      expect(references.value.manifest.externalReferences).toContainEqual({
        id: "font",
        logicalPath: "Missing.ttf",
        sha256: sha("font"),
        kind: "font",
        status: "relink_required",
      });
    await writeFile(join(dir, "A.png"), "A");
    doc.assets = {
      a: { kind: "image", logicalPath: "A.png", sha256: sha("A") },
      b: { kind: "image", logicalPath: "a.PNG", sha256: sha("A") },
    };
    expect(
      await packProject(doc, { projectDir: dir, outputPath: join(dir, "case.motionproj") }),
    ).toMatchObject({ ok: false, error: { code: "BUNDLE_PATH_COLLISION" } });
    const external = join(await temporary(), "outside.png");
    await writeFile(external, "A");
    await symlink(external, join(dir, "link.png"));
    doc.assets = { linked: { kind: "image", logicalPath: "link.png", sha256: sha("A") } };
    expect(
      await packProject(doc, { projectDir: dir, outputPath: join(dir, "link.motionproj") }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_BUNDLE_PATH" } });
  });

  it("includes only referenced definition artifacts and checks their content hash", async () => {
    const dir = await temporary(),
      doc = await fixture();
    const module = "export const definition = {};",
      moduleHash = sha(module);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "definitions"));
    await writeFile(join(dir, "definitions", `${moduleHash}.js`), module);
    await writeFile(
      join(dir, "definitions", `${moduleHash}.source.json`),
      '{"files":{"main.ts":"export const value=1"}}',
    );
    await writeFile(join(dir, "definitions", "unrelated.js"), "not referenced");
    doc.definitions.red.moduleHash = moduleHash;
    const result = await packProject(doc, { projectDir: dir, outputPath: join(dir, "custom.motionproj") });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest.files.map((entry) => entry.path)).toContain(
        `definitions/${moduleHash}.source.json`,
      );
      expect(result.value.manifest.files.map((entry) => entry.path)).not.toContain(
        "definitions/unrelated.js",
      );
    }
  });

  it("rejects private metadata and files declared outside project asset/definition scope", async () => {
    const dir = await temporary(),
      doc = await fixture();
    doc.provenance.sources.push("/Users/example/private/source.json");
    expect(
      await packProject(doc, { projectDir: dir, outputPath: join(dir, "private.motionproj") }),
    ).toMatchObject({ ok: false, error: { code: "NON_PORTABLE_PROJECT" } });
    doc.provenance.sources.pop();
    const entries = [
      { name: "project.json", data: JSON.stringify(doc) },
      { name: "extra.txt", data: "declared but unrelated" },
    ];
    const file = join(dir, "overscoped.motionproj");
    await archive(file, [...entries, { name: "manifest.json", data: manifest(entries) }]);
    expect(await unpackProject(file, join(dir, "overscoped-out"))).toMatchObject({
      ok: false,
      error: { code: "BUNDLE_MANIFEST_MISMATCH" },
    });
    doc.assets.accidental = { kind: "image", logicalPath: ".env", sha256: sha("secret-value") };
    await writeFile(join(dir, ".env"), "secret-value");
    expect(
      await packProject(doc, { projectDir: dir, outputPath: join(dir, "env.motionproj") }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_BUNDLE_PATH" } });
  });

  it("writes a standards-readable ZIP with valid CRCs and no missing dependency lock", async () => {
    const dir = await temporary(),
      doc = await fixture(),
      file = join(dir, "standard.motionproj");
    expect((await packProject(doc, { projectDir: dir, outputPath: file })).ok).toBe(true);
    const result = spawnSync(
      "python3",
      [
        "-c",
        "import sys,json,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({'bad':z.testzip(),'names':z.namelist()}))",
        file,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      bad: null,
      names: ["project.json", "dependency-lock.json", "manifest.json"],
    });
  });

  it("rejects traversal, symlinks, undeclared entries, corrupt hashes and inflated expansion before creating destination", async () => {
    const dir = await temporary(),
      doc = await fixture(),
      project = JSON.stringify(doc);
    const projectEntry = { name: "project.json", data: project };
    for (const [name, entries, code] of [
      ["traversal", [{ name: "../../outside", data: "x" }], "INVALID_BUNDLE_PATH"],
      ["symlink", [{ name: "link", data: "../../outside", symlink: true }], "INVALID_BUNDLE_PATH"],
      [
        "extra",
        [
          projectEntry,
          { name: "extra.txt", data: "x" },
          { name: "manifest.json", data: manifest([projectEntry]) },
        ],
        "BUNDLE_MANIFEST_MISMATCH",
      ],
      [
        "hash",
        [projectEntry, { name: "manifest.json", data: manifest([{ ...projectEntry, data: "wrong" }]) }],
        "BUNDLE_HASH_MISMATCH",
      ],
    ] as const) {
      const file = join(dir, `${name}.motionproj`),
        dest = join(dir, `${name}-out`);
      await archive(file, [...entries]);
      expect(await unpackProject(file, dest), name).toMatchObject({ ok: false, error: { code } });
      expect((await readdir(dir)).includes(`${name}-out`)).toBe(false);
    }
    const file = join(dir, "budget.motionproj");
    await archive(file, [projectEntry, { name: "manifest.json", data: manifest([projectEntry]) }]);
    expect(await unpackProject(file, join(dir, "budget-out"), { maxExpandedBytes: 64 })).toMatchObject({
      ok: false,
      error: { code: "BUNDLE_EXPANSION_LIMIT" },
    });
  });
});
