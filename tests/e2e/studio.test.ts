import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { expect, it } from "vitest";
import { runtime } from "../../apps/runner/src/environment";
import { startStudio } from "../../apps/runner/src/server";
import { loadProject, saveProject } from "../../packages/document/src/persistence";
import { createStarterProject } from "../../packages/document/src/starter";
import { expectOk } from "../helpers/result";

it("commits scaled canvas drags, undoes them, edits curves and keeps preview moving during playback", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motiframe-ui-")),
    file = path.join(dir, "project.json");
  const doc = createStarterProject("canvas-test");
  doc.settings.width = 640;
  doc.settings.height = 360;
  doc.instances.background.props.width = 640;
  doc.instances.background.props.height = 360;
  doc.instances.title.props.fontSize = 32;
  doc.instances.title.props.width = 450;
  doc.instances.title.props.height = 60;
  doc.channels["title:root:y"].keys[0].value = 120;
  expectOk(await saveProject(doc, file));
  const studio = expectOk(await startStudio(file, { port: 0 }));
  const browser = await puppeteer.launch({
    executablePath: (await runtime()).chrome,
    headless: true,
    args: ["--force-color-profile=srgb"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  await page.setViewport({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  try {
    await page.goto(studio.url);
    await page.waitForSelector(".stage-image img");
    await page.waitForSelector('rect[data-instance="title"]');
    expect(
      await page.$$eval("button", (elements) =>
        elements.some((element) => element.textContent?.trim() === "References"),
      ),
    ).toBe(false);
    await page.locator("button::-p-text(Adjust)").click();
    const box = await page.$eval('rect[data-instance="title"]', (e) => {
      const r = e.getBoundingClientRect();
      const image = document.querySelector(".stage-image")!.getBoundingClientRect();
      return { x: r.x + 20, y: r.y + 20, scale: image.width / 640 };
    });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + 100 * box.scale, box.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector(".save-status")?.textContent?.includes("rev 1"));
    const changed = expectOk(await loadProject(file));
    expect(changed.channels["title:root:x"].keys[0].value).toBeCloseTo(255, 0);
    expect(changed.instances.background.props).toEqual(doc.instances.background.props);
    await page.click('button[aria-label="Undo"]');
    await page.waitForFunction(() => document.querySelector(".save-status")?.textContent?.includes("rev 2"));
    expect(expectOk(await loadProject(file)).channels["title:root:x"].keys[0].value).toBe(155);
    await page.click('button[aria-label="Play"]');
    const first = await page.$eval(".stage-image img", (e) => (e as HTMLImageElement).src);
    await page.waitForFunction(
      (image) => (document.querySelector(".stage-image img") as HTMLImageElement)?.src !== image,
      {},
      first,
    );
    expect(await page.$eval('button[aria-label="Pause"]', (e) => Boolean(e))).toBe(true);
    await page.click('button[aria-label="Pause"]');
    await page.locator("button::-p-text(Curves)").click();
    await page.waitForSelector("svg[aria-label]");
    expect(await page.content()).toContain("Velocity");
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.resolve("artifacts/studio-ui.png"), fullPage: true });
  } finally {
    await browser.close();
    await studio.close();
  }
}, 30000);
