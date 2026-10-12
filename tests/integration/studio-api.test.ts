import { mkdtemp, readFile } from "node:fs/promises";
import { get } from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { projectStatePaths } from "../../apps/runner/src/project-storage";
import { startStudio } from "../../apps/runner/src/server";
import { loadProject, saveProject } from "../../packages/document/src/persistence";
import { createStarterProject } from "../../packages/document/src/starter";
import { expectOk } from "../helpers/result";

it("shares authenticated HTTP edits, source revisions and undo with persisted documents", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motiframe-api-")),
    file = path.join(dir, "project.json");
  const doc = createStarterProject("api");
  doc.settings.width = 320;
  doc.settings.height = 180;
  expectOk(await saveProject(doc, file));
  const studio = expectOk(await startStudio(file, { port: 0, headless: true }));
  const api = async (route: string, body?: unknown) => {
    const response = await fetch(`${studio.url}/api/${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-MotiFrame-Session": studio.token, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return response.json();
  };
  try {
    const forged = (route: string) =>
      new Promise<number | undefined>((resolve, reject) => {
        get(
          `${studio.url}${route}`,
          { headers: { Host: "attacker.test", "X-MotiFrame-Session": studio.token } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        ).on("error", reject);
      });
    expect(await forged("/")).toBe(403);
    expect(await forged("/api/project")).toBe(403);
    expect((await fetch(`${studio.url}/api/project`)).status).toBe(403);
    expect(
      (
        await fetch(`${studio.url}/api/project`, {
          headers: { "X-MotiFrame-Session": studio.token, Origin: "https://evil.test" },
        })
      ).status,
    ).toBe(403);
    const scope = {
      instanceIds: Object.keys(doc.instances),
      range: { start: 0, end: doc.settings.duration },
      preserveDuration: true,
      ripple: false,
    };
    const tx = {
      id: "external",
      baseRevision: 0,
      author: "agent",
      scope,
      commands: [{ type: "SetProps", instanceId: "title", props: { color: "#ff0000" } }],
    };
    expect(
      (
        await api("patch", {
          change: {
            protocolVersion: 1,
            requestId: "external",
            baseRevision: 0,
            transaction: tx,
            explanation: "Change selected title color",
            evidenceRefs: [],
          },
          dryRun: true,
        })
      ).ok,
    ).toBe(true);
    expect(expectOk(await loadProject(file)).revision).toBe(0);
    expect((await api("transaction", { transaction: tx })).ok).toBe(true);
    expect(expectOk(await loadProject(file)).revision).toBe(1);
    expect((await api("transaction", { transaction: { ...tx, id: "stale" } })).error.code).toBe(
      "REVISION_CONFLICT",
    );
    expect((await api("undo", {})).ok).toBe(true);
    expect(expectOk(await loadProject(file)).instances.title.props.color).toBe("#f3f3e9");
    const manifest = { ...doc.definitions.title, revision: 2 };
    const source = {
      manifest,
      files: {
        "index.tsx": `import {defineReactElement} from '@motiframe/authoring';export default defineReactElement(${JSON.stringify(manifest)},({props})=><div style={{width:100,height:50,background:String(props.color)}}>{String(props.text)}</div>);`,
      },
    };
    const request = {
      source,
      oldRef: { definitionId: "title", revision: 1 },
      instanceIds: ["title"],
      baseRevision: 2,
    };
    expect((await api("source", { ...request, baseRevision: 0 })).error.code).toBe("REVISION_CONFLICT");
    const result = await api("source", request);
    expect(expectOk<{ documentRevision: number }>(result).documentRevision).toBe(3);
    const persisted = expectOk(await loadProject(file));
    expect(persisted.instances.title.definitionId).toBe("title@2");
    const frame = await api("frame", { tick: 240000, revision: 3 });
    expect(frame.ok).toBe(true);
    expect(frame.value.image.startsWith("data:image/png;base64,")).toBe(true);
    expect((await api("context", { scope })).value.protocolVersion).toBe(1);
    expect((await api("knowledge", { text: "rhythm" })).value.candidates.length).toBeLessThanOrEqual(3);
    expect(JSON.parse(await readFile((await projectStatePaths(file)).history, "utf8")).past.length).toBe(1);
  } finally {
    await studio.close();
  }
}, 30000);
