import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { renderProject } from "../../apps/runner/src/render-job";
import { createStarterProject } from "../../packages/document/src/starter";

it("does not replace an existing output or source file when rendering", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motiframe-output-")),
    output = path.join(dir, "original.mp4");
  await writeFile(output, "preserve original bytes");
  const result = await renderProject(createStarterProject(), {
    projectDir: dir,
    outputPath: output,
    range: { start: 0, end: 8000 },
  });
  expect(result).toMatchObject({ ok: false, error: { code: "OUTPUT_EXISTS" } });
  expect(await readFile(output, "utf8")).toBe("preserve original bytes");
});

import { packProject } from "../../packages/document/src/bundle";

it("preserves a project source when a bundle output path already exists", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motiframe-pack-output-")),
    output = path.join(dir, "project.json");
  await writeFile(output, "preserve source");
  const result = await packProject(createStarterProject(), { projectDir: dir, outputPath: output });
  expect(result).toMatchObject({ ok: false, error: { code: "OUTPUT_EXISTS" } });
  expect(await readFile(output, "utf8")).toBe("preserve source");
});

it("rejects a sidecar collision before publishing a final video", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motiframe-sidecar-")),
    output = path.join(dir, "new.mp4");
  await writeFile(output + ".manifest.json", "preserve sidecar");
  expect(
    await renderProject(createStarterProject(), {
      projectDir: dir,
      outputPath: output,
      range: { start: 0, end: 8000 },
    }),
  ).toMatchObject({ ok: false, error: { code: "OUTPUT_EXISTS" } });
  expect(await readFile(output + ".manifest.json", "utf8")).toBe("preserve sidecar");
  await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
});
