import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { createServer } from "vite";
import { expect, it } from "vitest";
import { runtime } from "../../apps/runner/src/environment";
import { initProject } from "../../apps/runner/src/init-project";
import { packProject } from "../../packages/document/src/bundle";
import { loadProject } from "../../packages/document/src/persistence";
import { expectOk } from "../helpers/result";

it("opens portable projects without a runner and recovers browser edits from IndexedDB", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motiframe-browser-"));
  expectOk(await initProject(dir));
  const doc = expectOk(await loadProject(path.join(dir, "project.json")));
  const bundle = path.join(dir, "sample.motionproj");
  expectOk(await packProject(doc, { projectDir: dir, outputPath: bundle }));
  const vite = await createServer({
    configFile: false,
    root: path.resolve("apps/editor"),
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "error",
  });
  await vite.listen();
  const browser = await puppeteer.launch({ executablePath: (await runtime()).chrome, headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  await page.setViewport({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(vite.resolvedUrls!.local[0]);
    await page.waitForSelector('iframe[title="Motion preview"]');
    await page.waitForSelector('rect[data-instance="title"]');
    expect(await page.$eval(".project-name", (e) => e.textContent)).toContain("BROWSER");
    expect(
      await page.$$eval("button", (els) => els.some((e) => e.textContent?.trim() === "References")),
    ).toBe(false);
    const input = await page.$('input[aria-label="Open project"]');
    await input!.uploadFile(bundle);
    await page.waitForFunction(
      () => document.querySelector(".project-name")?.textContent?.includes("browser-project") === false,
    );
    const replacement = structuredClone(doc);
    replacement.instances.background.props.color = "#8844cc";
    const replacementFile = path.join(dir, "replacement.json");
    await writeFile(replacementFile, JSON.stringify(replacement));
    await input!.uploadFile(replacementFile);
    const stageFrame = page.frames().find((frame) => frame.url().includes("/stage.html"))!;
    await stageFrame.waitForFunction(
      () =>
        document
          .querySelector('[data-instance="background"]')
          ?.shadowRoot?.querySelector<HTMLElement>(".rectangle")?.style.background === "rgb(136, 68, 204)",
    );
    await page.locator("button::-p-text(Adjust)").click();
    await page.locator("button::-p-text(＋ Text)").click();
    await page.waitForFunction(() => document.querySelector(".save-status")?.textContent?.includes("rev 1"));
    await page.reload();
    await page.waitForSelector('rect[data-instance="title"]');
    expect(await page.$eval(".save-status", (e) => e.textContent)).toContain("rev 1");
    expect(await page.$$eval(".layer-row", (e) => e.length)).toBe(4);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await vite.close();
  }
}, 45000);
