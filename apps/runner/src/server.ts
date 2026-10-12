import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { buildDefinition, type DefinitionSource } from "../../../packages/authoring/src/build";
import { reconcileDefinition } from "../../../packages/authoring/src/reconcile";
import { getContext } from "../../../packages/automation/src/index";
import { reviewProject } from "../../../packages/core/src/review/report";
import { planPhrase } from "../../../packages/core/src/score/recipes";
import { applyTransaction } from "../../../packages/document/src/apply";
import { packProject } from "../../../packages/document/src/bundle";
import type { EditTransaction } from "../../../packages/document/src/commands";
import { recoverProject } from "../../../packages/document/src/recovery";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import { loadBundledKnowledge, queryKnowledge } from "../../../packages/knowledge/src/index";
import { mixAudio } from "../../../packages/media/src/audio-mix";
import { probeAsset } from "../../../packages/media/src/probe";
import { captureProject } from "./capture";
import { exportDiagnostics } from "./diagnostics";
import { projectRoot } from "./environment";
import { JobJournal } from "./job-journal";
import { createRenderJobManager } from "./jobs";
import { PreviewEngine } from "./preview";
import { acquireWriter, openDocumentService, projectStatePaths } from "./project-storage";
import { inspectAssetFiles, relinkAsset } from "./relink-asset";
import { addToneScore } from "./score-audio";
import { validSession } from "./session";
import { watchDefinitionSources } from "./source-watcher";
import { writeProjectArtifact } from "./write-artifact";

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024 * 1024) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function respond(response: ServerResponse, result: unknown, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(result));
}
export async function startStudio(
  file: string,
  options: { port?: number; headless?: boolean; production?: boolean } = {},
): Promise<Result<{ url: string; token: string; close: () => Promise<void> }>> {
  const lease = await acquireWriter(file);
  if (!lease.ok) return lease;
  const opened = await openDocumentService(file);
  if (!opened.ok) {
    await lease.value.close();
    return opened;
  }
  const service = opened.value,
    projectDir = path.dirname(path.resolve(file)),
    preview = new PreviewEngine(projectDir),
    variantPreview = new PreviewEngine(projectDir),
    jobs = createRenderJobManager(),
    jobIds = new Set<string>();
  const evidence = loadBundledKnowledge();
  const token = lease.value.token;
  let origin = "";
  const statePaths = await projectStatePaths(file);
  const journal = new JobJournal(statePaths.jobs);
  await journal.load();
  const journalErrors: string[] = journal.loadError ? [journal.loadError.message] : [];
  jobs.subscribe((job) => {
    void journal.record(job).catch((error) => journalErrors.push(String(error)));
  });
  let watcher: Awaited<ReturnType<typeof watchDefinitionSources>> | undefined;
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  const server = createServer(async (request, response) => {
    try {
      if (!origin || request.headers.host !== new URL(origin).host) {
        respond(response, fail("HOST_DENIED", "Use the local Studio URL printed by the runner"), 403);
        return;
      }
      const url = new URL(request.url ?? "/", origin || "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        if (
          !validSession(
            request.headers["x-motiframe-session"] as string | undefined,
            token,
            request.headers.origin,
            origin,
          )
        ) {
          respond(response, fail("SESSION_DENIED", "Session or origin is invalid"), 403);
          return;
        }
        const readRoutes = new Set([
          "/api/project",
          "/api/job",
          "/api/download",
          "/api/recovery",
          "/api/source-candidates",
          "/api/asset-status",
        ]);
        if (request.method !== (readRoutes.has(url.pathname) ? "GET" : "POST")) {
          respond(response, fail("METHOD_DENIED", "Use the documented HTTP method"), 405);
          return;
        }
        const body = request.method === "POST" ? await readBody(request) : {};
        const document = service.document;
        const scope = {
          instanceIds: Object.keys(document.instances),
          range: { start: 0, end: document.settings.duration },
          preserveDuration: true,
          ripple: false,
        };
        const tx = (commands: EditTransaction["commands"]): EditTransaction => ({
          id: randomUUID(),
          baseRevision: typeof body.baseRevision === "number" ? body.baseRevision : document.revision,
          author: "user",
          scope,
          commands,
        });
        switch (url.pathname) {
          case "/api/synthesize":
            respond(response, await addToneScore(service, body.score, projectDir));
            return;
          case "/api/asset-status":
            respond(response, await inspectAssetFiles(document, { projectDir }));
            return;
          case "/api/asset-relink":
            respond(
              response,
              await relinkAsset(document, String(body.assetId), {
                projectDir,
                bytes: Buffer.from(String(body.base64 ?? ""), "base64"),
              }),
            );
            return;
          case "/api/recovery":
            respond(
              response,
              ok({ project: await recoverProject(file), jobs: journal.list(), journalErrors }),
            );
            return;
          case "/api/diagnostics":
            respond(
              response,
              await exportDiagnostics(path.join(projectDir, "exports", "motiframe-diagnostics.json"), {
                revision: document.revision,
                jobs: journal.list(),
                journalErrors,
              }),
            );
            return;
          case "/api/source-candidates":
            respond(response, ok(watcher?.candidates() ?? []));
            return;
          case "/api/project":
            respond(
              response,
              ok({
                document,
                history: { undo: service.historyState.past.length, redo: service.historyState.future.length },
                events: service.eventsAfter(Number(url.searchParams.get("after") ?? -1)),
              }),
            );
            return;
          case "/api/transaction":
            respond(
              response,
              await service.submit(body.transaction as EditTransaction, {
                gestureId: body.gestureId as string | undefined,
              }),
            );
            return;
          case "/api/undo":
            respond(response, await service.undo());
            return;
          case "/api/redo":
            respond(response, await service.redo());
            return;
          case "/api/frame": {
            if (body.revision !== document.revision) {
              respond(response, fail("REVISION_CONFLICT", "Refresh the document before rendering"));
              return;
            }
            respond(response, await preview.frame(document, Number(body.tick)));
            return;
          }
          case "/api/variant-frame": {
            const changed = applyTransaction(document, body.transaction as EditTransaction);
            respond(
              response,
              changed.ok ? await variantPreview.frame(changed.value.document, Number(body.tick)) : changed,
            );
            return;
          }
          case "/api/context":
            respond(
              response,
              ok(
                getContext(
                  document,
                  (body.scope ?? scope) as typeof scope,
                  queryKnowledge(evidence, {
                    conceptIds: body.conceptIds as string[] | undefined,
                    text: body.text as string | undefined,
                    limit: 3,
                  }),
                ),
              ),
            );
            return;
          case "/api/patch": {
            respond(response, await service.patch(body.change, Boolean(body.dryRun)));
            return;
          }
          case "/api/knowledge":
            respond(
              response,
              ok(
                queryKnowledge(evidence, {
                  text: String(body.text ?? ""),
                  conceptIds: body.conceptIds as string[] | undefined,
                  limit: 3,
                }),
              ),
            );
            return;
          case "/api/review":
            respond(response, ok(reviewProject(document)));
            return;
          case "/api/audio": {
            const audioPath = path.join(
              statePaths.directory,
              `preview-audio-${document.revision}-${randomUUID()}.wav`,
            );
            const mixed = await mixAudio(
              document,
              { start: 0, end: document.settings.duration },
              { projectDir, outputPath: audioPath },
            );
            respond(
              response,
              mixed.ok
                ? ok({ dataUrl: `data:audio/wav;base64,${(await readFile(audioPath)).toString("base64")}` })
                : mixed,
            );
            return;
          }
          case "/api/recipe": {
            const planned = planPhrase(document, body.request as Parameters<typeof planPhrase>[1]);
            respond(response, planned.ok ? await service.submit(planned.value) : planned);
            return;
          }
          case "/api/source": {
            if (body.baseRevision !== document.revision) {
              respond(response, fail("REVISION_CONFLICT", "Refresh the source draft before applying"));
              return;
            }
            const source = body.source as DefinitionSource;
            const built = await buildDefinition(source);
            if (!built.ok) {
              respond(response, built);
              return;
            }
            const instanceIds = body.instanceIds as string[];
            const oldRef = body.oldRef as Parameters<typeof reconcileDefinition>[1];
            const candidate = reconcileDefinition(document, oldRef, built.value, {
              instanceIds,
              targetRemap: body.targetRemap as Record<string, string> | undefined,
            });
            if (!candidate.ok) {
              respond(response, candidate);
              return;
            }
            const artifactWrite = await writeProjectArtifact(
              projectDir,
              built.value.bundlePath,
              Buffer.from(built.value.code),
            );
            if (!artifactWrite.ok) {
              respond(response, artifactWrite);
              return;
            }
            const sourceWrite = await writeProjectArtifact(
              projectDir,
              `definitions/${built.value.moduleHash}.source.json`,
              Buffer.from(JSON.stringify(source, null, 2)),
            );
            if (!sourceWrite.ok) {
              respond(response, sourceWrite);
              return;
            }
            const captured = await captureProject(candidate.value.document, { tick: 0, projectDir });
            if (!captured.ok) {
              respond(response, captured);
              return;
            }
            respond(
              response,
              await service.submit(
                tx([
                  {
                    type: "ApplyDefinitionRevision",
                    oldRef,
                    artifact: { manifest: built.value.manifest, moduleHash: built.value.moduleHash },
                    instanceIds,
                    targetRemap: body.targetRemap as Record<string, string> | undefined,
                  },
                ]),
              ),
            );
            return;
          }
          case "/api/asset": {
            const name = String(body.name ?? "asset");
            const ext = path.extname(name).toLowerCase();
            if (
              ![
                ".mp4",
                ".mov",
                ".webm",
                ".png",
                ".jpg",
                ".jpeg",
                ".webp",
                ".wav",
                ".mp3",
                ".ttf",
                ".otf",
              ].includes(ext)
            ) {
              respond(response, fail("UNSUPPORTED_ASSET", "Unsupported asset type"));
              return;
            }
            const bytes = Buffer.from(String(body.base64 ?? ""), "base64"),
              sha256 = createHash("sha256").update(bytes).digest("hex");

            const logicalPath = `assets/${sha256}${ext}`;
            const written = await writeProjectArtifact(projectDir, logicalPath, bytes);
            if (!written.ok) {
              respond(response, written);
              return;
            }
            const font = [".ttf", ".otf"].includes(ext);
            const metadata = font ? undefined : await probeAsset(path.join(projectDir, logicalPath));
            if (metadata && !metadata.ok) {
              respond(response, metadata);
              return;
            }
            const kind = font
              ? "font"
              : [".png", ".jpg", ".jpeg", ".webp"].includes(ext)
                ? "image"
                : metadata?.ok && metadata.value.streams.some((s) => s.codec_type === "video")
                  ? "video"
                  : "audio";
            const asset = {
              sha256,
              logicalPath,
              kind,
              ...(metadata?.ok ? { mediaMetadata: metadata.value } : {}),
              ...(font ? { fontMetadata: { family: String(body.family ?? path.basename(name, ext)) } } : {}),
            };
            const result = await service.submit(tx([{ type: "RegisterAsset", assetId: sha256, asset }]));
            respond(
              response,
              result.ok
                ? ok({ assetId: sha256, asset, documentRevision: result.value.documentRevision })
                : result,
            );
            return;
          }
          case "/api/render": {
            if (body.format !== undefined && !["mp4", "png-sequence"].includes(String(body.format))) {
              respond(response, fail("INVALID_FORMAT", "Choose mp4 or png-sequence"));
              return;
            }
            const outputPath = path.join(
              projectDir,
              "exports",
              `${document.id.replace(/[^\p{L}\p{N}_-]/gu, "_")}-${Date.now()}.mp4`,
            );
            const started = jobs.start(document, {
              projectDir,
              outputPath: typeof body.outputPath === "string" ? path.resolve(body.outputPath) : outputPath,
              range: body.range as { start: number; end: number } | undefined,
              format: body.format === "png-sequence" ? "png-sequence" : "mp4",
            });
            if (started.ok) jobIds.add(started.value.jobId);
            respond(response, started);
            return;
          }
          case "/api/job":
            respond(response, jobs.status(String(url.searchParams.get("id") ?? body.jobId)));
            return;
          case "/api/wait":
            {
              const result = await jobs.wait(String(body.jobId));
              await journal.flush();
              respond(response, result);
            }
            return;
          case "/api/cancel":
            respond(response, jobs.cancel(String(body.jobId)));
            return;
          case "/api/pack": {
            const outputPath = path.join(
              projectDir,
              "exports",
              `${document.id.replace(/[^\p{L}\p{N}_-]/gu, "_")}-${Date.now()}.motionproj`,
            );
            respond(response, await packProject(document, { projectDir, outputPath }));
            return;
          }
          case "/api/download": {
            const status = jobs.status(String(url.searchParams.get("job")));
            if (!status.ok || !status.value.result) {
              respond(response, fail("OUTPUT_UNAVAILABLE", "Render is not complete"));
              return;
            }
            if ((await stat(status.value.result.outputPath)).isDirectory()) {
              respond(
                response,
                fail(
                  "PNG_SEQUENCE_LOCAL_ONLY",
                  "PNG sequence frames are already saved in the requested local directory. Open the render output directory to access the PNG files.",
                ),
              );
              return;
            }
            const bytes = await readFile(status.value.result.outputPath);
            response.writeHead(200, {
              "Content-Type": "video/mp4",
              "Content-Disposition": `attachment; filename="${path.basename(status.value.result.outputPath)}"`,
            });
            response.end(bytes);
            return;
          }
          default:
            respond(response, fail("UNKNOWN_COMMAND", "Unknown API route"), 404);
            return;
        }
      }
      if (request.headers.origin && request.headers.origin !== origin) {
        respond(response, fail("ORIGIN_DENIED", "Origin rejected"), 403);
        return;
      }
      if (options.production && !options.headless) {
        const root = await realpath(path.join(projectRoot, "dist/editor"));
        const name = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).slice(1);
        if (!/^(?:index\.html|stage\.html|assets\/[a-zA-Z0-9_.-]+)$/.test(name)) {
          response.writeHead(404);
          response.end();
          return;
        }
        const target = await realpath(path.join(root, name));
        if (!target.startsWith(root + path.sep)) {
          response.writeHead(403);
          response.end();
          return;
        }
        const bytes = await readFile(target);
        const ext = path.extname(target);
        const type =
          (
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".ttf": "font/ttf",
              ".woff2": "font/woff2",
            } as Record<string, string>
          )[ext] ?? "application/octet-stream";
        response.writeHead(200, {
          "Content-Type": type,
          "Cache-Control": ext === ".html" ? "no-store" : "public,max-age=31536000,immutable",
        });
        response.end(ext === ".html" ? bytes.toString().replace("__MOTIFRAME_SESSION__", token) : bytes);
        return;
      }
      if (url.pathname === "/" && vite) {
        let html = await readFile(path.join(projectRoot, "apps/editor/index.html"), "utf8");
        html = html.replace("__MOTIFRAME_SESSION__", token);
        html = await vite.transformIndexHtml("/", html);
        response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
        response.end(html);
        return;
      }
      if (vite)
        vite.middlewares(request, response, () => {
          response.writeHead(404);
          response.end();
        });
      else {
        response.writeHead(404);
        response.end();
      }
    } catch (error) {
      respond(response, fail("REQUEST_FAILED", error instanceof Error ? error.message : String(error)), 400);
    }
  });
  try {
    watcher = await watchDefinitionSources(
      projectDir,
      () => service.document,
      () => {},
    );
    if (!options.headless && !options.production)
      vite = await createViteServer({
        configFile: false,
        root: path.join(projectRoot, "apps/editor"),
        server: { middlewareMode: true, host: "127.0.0.1", hmr: { server } },
        appType: "custom",
        logLevel: "error",
      });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 4173, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await lease.value.publish(origin);
    let closed = false;
    return ok({
      url: origin,
      token,
      close: async () => {
        if (closed) return;
        closed = true;
        for (const id of jobIds) jobs.cancel(id);
        await preview.close();
        await variantPreview.close();
        await watcher?.close();
        await journal.flush();
        await vite?.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await lease.value.close();
      },
    });
  } catch (error) {
    await preview.close();
    await variantPreview.close();
    await watcher?.close();
    await journal.flush().catch(() => {});
    await vite?.close();
    server.close();
    await lease.value.close();
    return fail("SERVER_FAILED", String(error));
  }
}
