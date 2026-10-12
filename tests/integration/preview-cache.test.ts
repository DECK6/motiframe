import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { PreviewEngine } from "../../apps/runner/src/preview";
import { parseProject } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

it("reuses pixels outside an edited clip range while updating the receipt revision", async () => {
  const doc = expectOk(
    parseProject(JSON.parse(await readFile("tests/fixtures/mixed-static/project.json", "utf8"))),
  );
  doc.instances.blue.start = 120000;
  doc.instances.blue.duration = 120000;
  const engine = new PreviewEngine(process.cwd());
  try {
    const first = expectOk(await engine.frame(doc, 0));
    const next = structuredClone(doc);
    next.revision++;
    next.instances.blue.props.color = "#00ff00";
    const second = expectOk(await engine.frame(next, 0));
    expect(second.image).toBe(first.image);
    expect(second.receipt.documentRevision).toBe(1);
    expect(engine.stats.hits).toBe(1);
    expect(engine.stats.entries).toBe(1);
  } finally {
    await engine.close();
  }
});
