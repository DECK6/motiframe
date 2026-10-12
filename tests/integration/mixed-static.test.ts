import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { captureProject } from "../../apps/runner/src/capture";
import { expectOk } from "../helpers/result";

describe("mixed static authoring", () => {
  it("renders React and HTML in one document with the HTML layer in front", async () => {
    // Break caught: separate stage documents, missing React commit, or reversed layer order.
    const project = JSON.parse(await readFile("tests/fixtures/mixed-static/project.json", "utf8"));
    const result = await captureProject(project, { tick: 0 });
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    const frame = expectOk(result);
    expect(frame.inspection.sameDocument).toBe(true);
    expect(frame.inspection.kinds).toEqual(["react", "html"]);
    const decoded = PNG.sync.read(Buffer.from(frame.png));
    const pixel = (x: number, y: number) => [
      ...decoded.data.subarray((y * decoded.width + x) * 4, (y * decoded.width + x) * 4 + 4),
    ];
    expect(pixel(100, 100)).toEqual([0, 0, 255, 255]);
    expect(pixel(60, 60)).toEqual([255, 0, 0, 255]);
    expect(pixel(10, 10)).toEqual([0, 0, 0, 255]);
    expect(frame.receipt.ready).toBe(true);
    await mkdir("artifacts/T01", { recursive: true });
    await writeFile("artifacts/T01/mixed-static.png", frame.png);
    await writeFile("artifacts/T01/receipt.json", JSON.stringify(frame.inspection, null, 2));
  });
});
