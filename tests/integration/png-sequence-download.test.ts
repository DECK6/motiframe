import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { projectRoot, runtime } from "../../apps/runner/src/environment";
import type { RenderManifest } from "../../apps/runner/src/render-job";
import { startStudio } from "../../apps/runner/src/server";
import { saveProject } from "../../packages/document/src/persistence";
import type { Result } from "../../packages/document/src/result";
import { createStarterProject } from "../../packages/document/src/starter";
import { expectOk } from "../helpers/result";

let directory: string,
  file: string,
  node: string,
  studio: Awaited<ReturnType<typeof startStudio>> extends Result<infer T> ? T : never;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "motiframe-png-api-"));
  file = path.join(directory, "project.json");
  const document = createStarterProject("png-api");
  document.settings.width = 160;
  document.settings.height = 90;
  expectOk(await saveProject(document, file));
  studio = expectOk(await startStudio(file, { port: 0, headless: true }));
  node = (await runtime()).node;
});
afterAll(async () => {
  await studio?.close();
});
const api = async <T>(route: string, body?: unknown): Promise<Result<T>> => {
  const response = await fetch(`${studio.url}/api/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-MotiFrame-Session": studio.token, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response.json();
};
async function cli(args: string[]) {
  try {
    const result = await promisify(execFile)(node, [path.join(projectRoot, "dist/runner/cli.mjs"), ...args], {
      env: { ...process.env, MOTIFRAME_ROOT: projectRoot },
      timeout: 30000,
    });
    return { exitCode: 0, result: JSON.parse(result.stdout) };
  } catch (error) {
    const failure = error as { code: number; stdout?: string };
    if (!failure.stdout) throw error;
    return { exitCode: failure.code, result: JSON.parse(failure.stdout) };
  }
}
it("reports PNG_SEQUENCE_LOCAL_ONLY after a real PNG render and retains its local frames", async () => {
  const outputPath = path.join(directory, "api-frames");
  const job = expectOk(
    await api<{ jobId: string }>("render", {
      format: "png-sequence",
      outputPath,
      range: { start: 0, end: 16000 },
    }),
  );
  const manifest = expectOk(await api<RenderManifest>("wait", job));
  expect(manifest.frames).toBe(2);
  expect(manifest.outputPath).toBe(outputPath);
  expect(await api(`download?job=${job.jobId}`)).toMatchObject({
    ok: false,
    error: {
      code: "PNG_SEQUENCE_LOCAL_ONLY",
      message: expect.stringMatching(/already saved.*local directory/i),
    },
  });
  expect(await readdir(outputPath)).toEqual(["000000.png", "000001.png"]);
  const png = await readFile(path.join(outputPath, "000000.png"));
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
}, 30000);
it("forwards PNG sequence format and wait from the built CLI to the live writer", async () => {
  const outputPath = path.join(directory, "cli-frames"),
    result = await cli([
      "render",
      file,
      "--format",
      "png-sequence",
      "--start",
      "0",
      "--end",
      "16000",
      "--output",
      outputPath,
      "--wait",
    ]);
  expect(result.exitCode).toBe(0);
  expect(expectOk<RenderManifest>(result.result).frames).toBe(2);
  expect(await readdir(outputPath)).toEqual(["000000.png", "000001.png"]);
  const recovery = expectOk(await api<{ jobs: { state: string; result?: RenderManifest }[] }>("recovery"));
  expect(
    recovery.jobs.some((job) => job.state === "completed" && job.result?.outputPath === outputPath),
  ).toBe(true);
}, 30000);
it("refuses an existing capture output with OUTPUT_EXISTS and preserves its bytes", async () => {
  const output = path.join(directory, "existing.png"),
    original = Buffer.from("preserve the existing capture");
  await writeFile(output, original);
  const result = await cli(["capture", file, "--tick", "0", "--output", output]);
  expect(result.exitCode).toBe(4);
  expect(result.result).toMatchObject({ ok: false, error: { code: "OUTPUT_EXISTS" } });
  expect(await readFile(output)).toEqual(original);
}, 30000);
