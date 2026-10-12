import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { resolveAssets } from "../../apps/runner/src/asset-broker";
import { validSession } from "../../apps/runner/src/session";
import { openStage } from "../../apps/runner/src/stage-session";
import { buildDefinition } from "../../packages/authoring/src/build";
import type { ProjectDocument } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

const project = async () =>
  JSON.parse(await readFile("tests/fixtures/mixed-static/project.json", "utf8")) as ProjectDocument;
it("bundles an SDK element and rejects Node/network imports and path traversal", async () => {
  const doc = await project();
  const manifest = Object.values(doc.definitions)[0];
  const source = {
    manifest,
    files: {
      "index.tsx": `import {defineReactElement} from '@motiframe/authoring'; export default defineReactElement(${JSON.stringify(manifest)},()=> <span>safe</span>);`,
    },
  };
  expect(expectOk(await buildDefinition(source)).code).toContain("safe");
  for (const forbidden of ["node:fs", "https://example.com/code.js", "../../../outside"]) {
    const result = await buildDefinition({
      ...source,
      files: { "index.tsx": `import x from '${forbidden}'; export default x;` },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CAPABILITY_DENIED");
  }
  doc.assets.bad = { logicalPath: "../../../../etc/passwd", kind: "image" };
  const escaped = await resolveAssets(doc, process.cwd());
  expect(escaped.ok).toBe(false);
});
it("authenticates loopback sessions and denies cross-origin requests", () => {
  expect(validSession("secret", "secret", "http://localhost:4173", "http://localhost:4173")).toBe(true);
  expect(validSession("wrong", "secret", "http://localhost:4173", "http://localhost:4173")).toBe(false);
  expect(validSession("secret", "secret", "https://evil.test", "http://localhost:4173")).toBe(false);
});
it("blocks network in the source renderer and recovers after an infinite source", async () => {
  const stage = await openStage(320, 180);
  try {
    const attempt = await stage.page.evaluate(async () => {
      try {
        await fetch("https://example.com/");
        return true;
      } catch {
        return false;
      }
    });
    expect(attempt).toBe(false);
    const loop = stage.page
      .evaluate(() => {
        while (true) {}
      })
      .catch(() => undefined);
    const start = performance.now();
    await stage.close();
    await loop;
    expect(performance.now() - start).toBeLessThan(1000);
  } finally {
    await stage.close();
  }
  const recovery = await openStage(320, 180);
  await recovery.close();
}, 15000);
