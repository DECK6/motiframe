import { readFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { beforeAll, expect, it } from "vitest";
import { captureProject } from "../../apps/runner/src/capture";
import { createShowcases } from "../../scripts/create-showcase";
import { expectOk } from "../helpers/result";

const folder = path.resolve(`artifacts/showcase-pixels/${crypto.randomUUID()}`);
beforeAll(async () => {
  await createShowcases(folder);
}, 120000);
async function frame(name: string, seconds: number) {
  const projectDir = path.join(folder, name),
    document = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"));
  return PNG.sync.read(
    Buffer.from(expectOk(await captureProject(document, { tick: seconds * 240000, projectDir })).png),
  );
}
it("paints the final HTML field paper color behind the dark message", async () => {
  const png = await frame("mixed", 25),
    offset = (320 * png.width + 610) * 4;
  for (const channel of png.data.subarray(offset, offset + 3)) expect(channel).toBeGreaterThan(210);
}, 120000);
it("paints the warm tension disc as a filled shape", async () => {
  const png = await frame("slow-tension", 5);
  let orangePixels = 0;
  for (let y = 255; y < 300; y++)
    for (let x = 420; x < 570; x++) {
      const offset = (y * png.width + x) * 4,
        [red, green, blue] = png.data.subarray(offset, offset + 3);
      if (red > 220 && green > 145 && green < 195 && blue > 95 && blue < 145) orangePixels++;
    }
  expect(orangePixels).toBeGreaterThan(150);
}, 120000);
