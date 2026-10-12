import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runtime } from "../../apps/runner/src/environment";
import { startStudio } from "../../apps/runner/src/server";
import { saveProject } from "../../packages/document/src/persistence";
import { createStarterProject } from "../../packages/document/src/starter";
import { launchReviewBrowser } from "../helpers/browser";
import { expectOk } from "../helpers/result";

it("drags the CTI across time labels continuously without selecting text and keeps capture outside the ruler", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motiframe-scrub-")),
    file = path.join(dir, "project.json");
  expectOk(await saveProject(createStarterProject(), file));
  const studio = expectOk(await startStudio(file, { port: 0 }));
  const browser = await launchReviewBrowser((await runtime()).chrome);
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  try {
    await page.goto(studio.url);
    await page.waitForSelector(".time-ruler");
    const box = await page.$eval(".time-ruler", (element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    await page.mouse.move(box.x + 75, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 10, { steps: 12 });
    expect(
      await page.$eval('input[aria-label="Playhead"]', (e) => Number((e as HTMLInputElement).value)),
    ).toBe(4 * 240000);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
    await page.mouse.move(box.x + 375, box.y + 70, { steps: 4 });
    expect(
      await page.$eval('input[aria-label="Playhead"]', (e) => Number((e as HTMLInputElement).value)),
    ).toBe(5 * 240000);
    await page.mouse.up();
    await page.mouse.move(box.x + 450, box.y + 10);
    expect(
      await page.$eval('input[aria-label="Playhead"]', (e) => Number((e as HTMLInputElement).value)),
    ).toBe(5 * 240000);
  } finally {
    await browser.close();
    await studio.close();
  }
}, 30000);
