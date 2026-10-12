import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { buildDefinition, type DefinitionSource } from "../../../packages/authoring/src/build";
import { reconcileDefinition } from "../../../packages/authoring/src/reconcile";
import { getContext } from "../../../packages/automation/src/index";
import { compileProject } from "../../../packages/core/src/compile";
import { reviewProject } from "../../../packages/core/src/review/report";
import { packProject, unpackProject } from "../../../packages/document/src/bundle";
import { projectContentHash } from "../../../packages/document/src/history";
import { loadProject } from "../../../packages/document/src/persistence";
import { recoverProject, restoreSnapshot } from "../../../packages/document/src/recovery";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import { projectSchema } from "../../../packages/document/src/schema";
import { loadBundledKnowledge, queryKnowledge } from "../../../packages/knowledge/src/index";
import { captureProject } from "./capture";
import { doctor, exportDiagnostics } from "./diagnostics";
import type { DocumentService } from "./document-service";
import { projectRoot, runtime } from "./environment";
import { initProject } from "./init-project";
import { acquireWriter, openDocumentService, readWriter } from "./project-storage";
import { inspectAssetFiles, relinkAsset } from "./relink-asset";
import { renderProject } from "./render-job";
import { addToneScore } from "./score-audio";
import { startStudio } from "./server";
import { writeProjectArtifact } from "./write-artifact";

const requestId = randomUUID();
function print(result: Result<unknown>) {
  process.stdout.write(`${JSON.stringify({ protocolVersion: 1, requestId, ...result })}\n`);
  if (!result.ok)
    process.exitCode =
      result.error.code === "CANCELLED"
        ? 130
        : /CONFLICT|LOCKED|OWNERSHIP|WRITER_ACTIVE/.test(result.error.code)
          ? 3
          : /INVALID|UNKNOWN|MISSING|REQUIRED|SCHEMA/.test(result.error.code)
            ? 2
            : 4;
}
async function remote(file: string, route: string, body: unknown): Promise<Result<unknown> | undefined> {
  const writer = await readWriter(file);
  if (!writer?.endpoint) return undefined;
  try {
    process.kill(writer.pid, 0);
  } catch {
    return undefined;
  }
  try {
    const response = await fetch(`${writer.endpoint}/api/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-MotiFrame-Session": writer.token },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Result<unknown>;
  } catch (error) {
    return fail("RUNNER_UNAVAILABLE", `Active writer connection failed: ${String(error)}`);
  }
}
async function mutate(
  file: string,
  route: string,
  body: unknown,
  work: (service: DocumentService) => Promise<Result<unknown>>,
): Promise<Result<unknown>> {
  const live = await remote(file, route, body);
  if (live) return live;
  const lease = await acquireWriter(file);
  if (!lease.ok) return lease;
  try {
    const opened = await openDocumentService(file);
    return opened.ok ? await work(opened.value) : opened;
  } finally {
    await lease.value.close();
  }
}
async function main(): Promise<Result<unknown> | undefined> {
  const { values: v, positionals: p } = parseArgs({
    allowPositionals: true,
    options: {
      tick: { type: "string", default: "0" },
      output: { type: "string" },
      json: { type: "boolean" },
      file: { type: "string" },
      wait: { type: "boolean" },
      "dry-run": { type: "boolean" },
      headless: { type: "boolean" },
      dev: { type: "boolean" },
      port: { type: "string" },
      format: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
    },
  });
  const command = p[0],
    file = p[1] ? path.resolve(p[1]) : undefined;
  const payload = v.file
    ? JSON.parse(
        v.file === "-"
          ? await new Promise<string>((resolve, reject) => {
              let data = "";
              process.stdin.setEncoding("utf8");
              process.stdin.on("data", (chunk) => {
                data += chunk;
              });
              process.stdin.on("end", () => resolve(data));
              process.stdin.on("error", reject);
            })
          : await readFile(v.file, "utf8"),
      )
    : {};
  if (!command || command === "help")
    return ok({
      name: "MotiFrame",
      version: "0.1.0",
      commands: [
        "init <directory>",
        "studio <project.json>",
        "inspect|context|validate|review <project.json>",
        "patch <project.json> --file changeset.json [--dry-run]",
        "element build <project.json> --file source.json",
        "knowledge query --file query.json",
        "capture <project.json> --tick 0 --output frame.png",
        "render <project.json> --output video.mp4 [--wait]",
        "pack <project.json> --output project.motionproj",
        "unpack <project.motionproj> --output directory",
        "kit --output directory",
        "synthesize <project.json> --file tone-score.json",
        "assets <project.json>",
        "relink <project.json> --file relink.json",
        "doctor --json",
        "diagnostics --output report.json",
        "recover <project.json> [--file snapshot-selection.json]",
      ],
    });
  if (command === "init")
    return file ? initProject(file) : fail("MISSING_PATH", "Specify a project directory");
  if (command === "doctor") return doctor();
  if (command === "diagnostics")
    return v.output ? exportDiagnostics(v.output) : fail("MISSING_OUTPUT", "Specify diagnostics output");
  if (command === "recover" && file) {
    if (!payload.snapshot) return recoverProject(file);
    const lease = await acquireWriter(file);
    if (!lease.ok) return lease;
    try {
      return await restoreSnapshot(file, String(payload.snapshot));
    } finally {
      await lease.value.close();
    }
  }
  if (command === "kit") {
    if (!v.output) return fail("MISSING_OUTPUT", "Specify kit output directory");
    await mkdir(v.output, { recursive: true });
    await cp(path.join(projectRoot, "dist/sdk"), path.join(v.output, "sdk"), {
      recursive: true,
      filter: (source) => !path.basename(source).startsWith(".sdk-build-"),
    });
    await cp(path.join(projectRoot, "skills/motiframe"), path.join(v.output, "motiframe"), {
      recursive: true,
    });
    await writeFile(
      path.join(v.output, "project.schema.json"),
      JSON.stringify(z.toJSONSchema(projectSchema), null, 2),
    );
    await writeFile(
      path.join(v.output, "version.json"),
      JSON.stringify({ sdk: "0.1.0", cli: "0.1.0", protocolVersion: 1 }, null, 2),
    );
    return ok({ path: path.resolve(v.output) });
  }
  if (command === "knowledge") return ok(queryKnowledge(loadBundledKnowledge(), payload));
  if (command === "unpack")
    return file && v.output
      ? unpackProject(file, v.output)
      : fail("MISSING_PATH", "Specify bundle and destination");
  if (command === "element") {
    const projectFile = p[2] ? path.resolve(p[2]) : undefined;
    if (p[1] !== "build" || !projectFile)
      return fail("INVALID_COMMAND", "Use element build <project.json> --file source.json");
    const loaded = await loadProject(projectFile);
    if (!loaded.ok) return loaded;
    const source = (payload.source ?? payload) as DefinitionSource;
    const document = loaded.value;
    const oldKey = Object.keys(document.definitions).find(
      (key) => document.definitions[key].id === source.manifest.id,
    );
    if (!oldKey) return fail("MISSING_DEFINITION", "Start by revising an existing selected definition");
    const oldRef = payload.oldRef ?? {
      definitionId: oldKey,
      revision: document.definitions[oldKey].revision,
    };
    const instanceIds =
      payload.instanceIds ??
      Object.keys(document.instances).filter((id) => document.instances[id].definitionId === oldKey);
    const baseRevision = payload.baseRevision ?? document.revision;
    const body = { source, oldRef, instanceIds, baseRevision, targetRemap: payload.targetRemap };
    return mutate(projectFile, "source", body, async (service) => {
      if (service.document.revision !== baseRevision)
        return fail("REVISION_CONFLICT", "Definition draft is stale");
      const built = await buildDefinition(source);
      if (!built.ok) return built;
      const candidate = reconcileDefinition(service.document, oldRef, built.value, {
        instanceIds,
        targetRemap: payload.targetRemap,
      });
      if (!candidate.ok) return candidate;
      const dir = path.dirname(projectFile);
      const written = await writeProjectArtifact(dir, built.value.bundlePath, Buffer.from(built.value.code));
      if (!written.ok) return written;
      const sourceWritten = await writeProjectArtifact(
        dir,
        `definitions/${built.value.moduleHash}.source.json`,
        Buffer.from(JSON.stringify(source, null, 2)),
      );
      if (!sourceWritten.ok) return sourceWritten;
      const frame = await captureProject(candidate.value.document, { projectDir: dir, tick: 0 });
      if (!frame.ok) return frame;
      return service.submit({
        id: requestId,
        baseRevision,
        author: "user",
        scope: {
          instanceIds: Object.keys(service.document.instances),
          range: { start: 0, end: service.document.settings.duration },
          preserveDuration: true,
          ripple: false,
        },
        commands: [
          {
            type: "ApplyDefinitionRevision",
            oldRef,
            artifact: { manifest: built.value.manifest, moduleHash: built.value.moduleHash },
            instanceIds,
            targetRemap: payload.targetRemap,
          },
        ],
      });
    });
  }
  if (!file) return fail("MISSING_PROJECT", "Specify project.json");
  if (command === "studio") {
    const started = await startStudio(file, {
      port: Number(v.port ?? 4173),
      headless: v.headless,
      production: !v.dev,
    });
    if (!started.ok) return started;
    print(ok({ url: started.value.url, project: path.basename(file) }));
    let exiting = false;
    const close = () => {
      if (exiting) return;
      exiting = true;
      void started.value.close().then(() => process.exit(0));
    };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
    return undefined;
  }
  const loaded = await loadProject(file);
  if (!loaded.ok) return loaded;
  const doc = loaded.value,
    projectDir = path.dirname(file);
  const scope = payload.scope ?? {
    instanceIds: Object.keys(doc.instances),
    range: { start: 0, end: doc.settings.duration },
    preserveDuration: true,
    ripple: false,
  };
  if (command === "inspect") return ok({ document: doc, contentHash: projectContentHash(doc) });
  if (command === "synthesize")
    return mutate(file, "synthesize", { score: payload }, (service) =>
      addToneScore(service, payload, projectDir),
    );
  if (command === "assets") return inspectAssetFiles(doc, { projectDir });
  if (command === "relink")
    return mutate(file, "asset-relink", payload, (service) =>
      relinkAsset(service.document, String(payload.assetId), {
        projectDir,
        bytes: Buffer.from(String(payload.base64 ?? ""), "base64"),
      }),
    );
  if (command === "validate") {
    const compiled = compileProject(doc);
    return compiled.ok ? ok({ documentRevision: doc.revision, valid: true }) : compiled;
  }
  if (command === "review") return ok(reviewProject(doc));
  if (command === "context")
    return ok(
      getContext(
        doc,
        scope,
        queryKnowledge(loadBundledKnowledge(), {
          conceptIds: payload.conceptIds,
          text: payload.text,
          limit: 3,
        }),
      ),
    );
  if (command === "patch")
    return mutate(file, "patch", { change: payload, dryRun: v["dry-run"] }, (service) =>
      service.patch(payload, Boolean(v["dry-run"])),
    );
  if (command === "capture") {
    if (!v.output) return fail("MISSING_OUTPUT", "Specify frame output");
    const result = await captureProject(doc, { tick: Number(v.tick), projectDir });
    if (!result.ok) return result;
    await mkdir(path.dirname(v.output), { recursive: true });
    try {
      await writeFile(v.output, result.value.png, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        return fail("OUTPUT_EXISTS", "Choose a new frame output path; existing files are preserved");
      throw error;
    }
    return ok({
      output: path.resolve(v.output),
      receipt: result.value.receipt,
      inspection: result.value.inspection,
    });
  }
  if (command === "pack")
    return v.output
      ? packProject(doc, { projectDir, outputPath: v.output })
      : fail("MISSING_OUTPUT", "Specify bundle output");
  if (command === "render") {
    if (v.format && !["mp4", "png-sequence"].includes(v.format))
      return fail("INVALID_FORMAT", "Choose mp4 or png-sequence");
    if (!v.output) return fail("MISSING_OUTPUT", "Specify video output");
    const range =
      v.start !== undefined || v.end !== undefined
        ? { start: Number(v.start ?? 0), end: Number(v.end ?? doc.settings.duration) }
        : undefined;
    let started = await remote(file, "render", {
      outputPath: path.resolve(v.output),
      range,
      format: v.format,
    });
    if (!started && !v.wait) {
      const config = await runtime();
      const child = spawn(
        config.node,
        [path.join(projectRoot, "dist/runner/cli.mjs"), "studio", file, "--headless", "--port", "0"],
        { detached: true, stdio: "ignore", env: { ...process.env, MOTIFRAME_ROOT: projectRoot } },
      );
      child.unref();
      for (let n = 0; n < 150; n++) {
        await new Promise((r) => setTimeout(r, 100));
        const writer = await readWriter(file);
        if (writer?.endpoint) {
          started = await remote(file, "render", {
            outputPath: path.resolve(v.output),
            range,
            format: v.format,
          });
          break;
        }
      }
      if (!started) return fail("RUNNER_UNAVAILABLE", "Background runner did not start");
    }
    if (started) {
      if (!started.ok || !v.wait) return started;
      return (
        (await remote(file, "wait", started.value)) ??
        fail("RUNNER_UNAVAILABLE", "Render runner disconnected")
      );
    }
    const abort = new AbortController();
    process.once("SIGINT", () => abort.abort());
    return renderProject(doc, {
      projectDir,
      outputPath: v.output,
      format: v.format === "png-sequence" ? "png-sequence" : "mp4",
      range,
      signal: abort.signal,
    });
  }
  return fail("UNKNOWN_COMMAND", `Unknown command: ${command}`);
}
try {
  const result = await main();
  if (result) print(result);
} catch (error) {
  print(fail("INVALID_INPUT", error instanceof Error ? error.message : String(error)));
}
