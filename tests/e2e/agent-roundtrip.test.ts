import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";
import { expect, it } from "vitest";
import { projectRoot, runtime } from "../../apps/runner/src/environment";
import { startStudio } from "../../apps/runner/src/server";
import { projectContentHash } from "../../packages/document/src/history";
import { loadProject, saveProject } from "../../packages/document/src/persistence";
import { createStarterProject } from "../../packages/document/src/starter";
import { expectOk } from "../helpers/result";

it("round-trips external CLI edits through the live review UI and shared undo without losing manual work", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motiframe-agent-")),
    file = path.join(dir, "project.json");
  expectOk(await saveProject(createStarterProject("agent-roundtrip"), file));
  const studio = expectOk(await startStudio(file, { port: 0 }));
  const config = await runtime();
  const browser = await puppeteer.launch({ executablePath: config.chrome, headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  await page.setViewport({ width: 1440, height: 1000 });
  const transcript: unknown[] = [];
  const cli = async (args: string[]) => {
    const result = await promisify(execFile)(
      config.node,
      [path.join(projectRoot, "dist/runner/cli.mjs"), ...args],
      { env: { ...process.env, MOTIFRAME_ROOT: projectRoot }, timeout: 30000 },
    );
    const response = JSON.parse(result.stdout.trim());
    transcript.push({ command: args.map((x) => (x.startsWith(dir) ? path.basename(x) : x)), response });
    return expectOk<any>(response);
  };
  try {
    await page.goto(studio.url);
    await page.waitForSelector(".save-status");
    await page.locator("button::-p-text(Adjust)").click();
    await page.locator("button::-p-text(＋ Shape)").click();
    await page.waitForFunction(() => document.querySelector(".save-status")?.textContent?.includes("rev 1"));
    const before = expectOk(await loadProject(file));
    const context = await cli(["context", file]);
    expect(context.baseRevision ?? context.documentRevision ?? context.document?.revision).toBeDefined();
    const change = {
      protocolVersion: 1,
      requestId: "agent-color",
      baseRevision: 1,
      explanation: "Change only the selected title; retain the shape added in the UI.",
      evidenceRefs: [],
      transaction: {
        id: "agent-color",
        author: "agent",
        baseRevision: 1,
        scope: {
          instanceIds: ["title"],
          range: { start: 0, end: before.settings.duration },
          preserveDuration: true,
          ripple: false,
        },
        commands: [{ type: "SetProps", instanceId: "title", props: { color: "#ffd166" } }],
      },
    };
    const changeFile = path.join(dir, "change.json");
    await writeFile(changeFile, JSON.stringify(change));
    await cli(["patch", file, "--file", changeFile, "--dry-run"]);
    expect(expectOk(await loadProject(file)).revision).toBe(1);
    await cli(["patch", file, "--file", changeFile]);
    await cli(["patch", file, "--file", changeFile]);
    await page.waitForFunction(() => document.querySelector(".save-status")?.textContent?.includes("rev 2"));
    const after = expectOk(await loadProject(file));
    expect(Object.keys(after.instances)).toEqual(Object.keys(before.instances));
    expect(after.instances.title.props.color).toBe("#ffd166");
    await page.click('button[aria-label="Undo"]');
    await page.waitForFunction(() => document.querySelector(".save-status")?.textContent?.includes("rev 3"));
    expect(projectContentHash(expectOk(await loadProject(file)))).toBe(projectContentHash(before));
    await page.click('button[aria-label="Redo"]');
    await page.waitForFunction(() => document.querySelector(".save-status")?.textContent?.includes("rev 4"));
    expect(expectOk(await loadProject(file)).instances.title.props.color).toBe("#ffd166");
    await writeFile(
      path.join(projectRoot, "artifacts/agent-roundtrip.json"),
      JSON.stringify(
        {
          transcript,
          manualRevision: 1,
          agentRevision: 2,
          retryCommits: 1,
          undoRevision: 3,
          redoRevision: 4,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    await studio.close();
  }
}, 60000);
