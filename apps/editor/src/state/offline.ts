import { getContext, validateChangeSet } from "../../../../packages/automation/src/index";
import { createVariant } from "../../../../packages/automation/src/variants";
import { compileProject } from "../../../../packages/core/src/compile";
import { evaluateFrame, type FramePlan } from "../../../../packages/core/src/evaluate";
import { reviewProject } from "../../../../packages/core/src/review/report";
import { planPhrase } from "../../../../packages/core/src/score/recipes";
import { type PhraseRequest, validateScore } from "../../../../packages/core/src/score/schema";
import { projectContentHash } from "../../../../packages/document/src/apply";
import {
  type BrowserAsset,
  type BrowserStorage,
  bytesToDataUrl,
  createBrowserStorage,
  dataUrlToBytes,
  exportBrowserBundle,
  importBrowserBundle,
  serializeBrowserProject,
  sha256Bytes,
} from "../../../../packages/document/src/browser-storage";
import type { EditScope, EditTransaction } from "../../../../packages/document/src/commands";
import {
  commitHistory,
  createHistory,
  type HistoryState,
  redo,
  undo,
} from "../../../../packages/document/src/history";
import { fail, ok, type Result } from "../../../../packages/document/src/result";
import { type ProjectDocument, parseProject } from "../../../../packages/document/src/schema";
import { createStarterProject } from "../../../../packages/document/src/starter";
import { queryKnowledge } from "../../../../packages/knowledge/src/query";
import type { EvidencePacket, KnowledgeSnapshot } from "../../../../packages/knowledge/src/schema";
import type { StageAssets } from "../../../../packages/stage/src/main";
export type OfflineReceipt = {
  requestId: string;
  documentRevision: number;
  affectedIds: string[];
  contentHash: string;
};
export type OfflineDocumentStore = {
  getDocument: () => ProjectDocument;
  subscribe: (listener: () => void) => () => void;
  api: <T>(route: string, body?: unknown) => Promise<Result<T>>;
  getOfflineProjectAssets: () => Promise<Result<StageAssets>>;
  getAssetData: (assetId: string) => Promise<Result<string>>;
  evaluate: (tick: number) => Result<FramePlan>;
  importProjectJson: (text: string) => Promise<Result<ProjectDocument>>;
  exportProjectJson: () => Result<string>;
  addAsset: (
    file: Blob & { name?: string },
    kind?: string,
    family?: string,
  ) => Promise<
    Result<{ assetId: string; asset: ProjectDocument["assets"][string]; documentRevision: number }>
  >;
  exportBundle: () => Promise<Result<Blob>>;
  importBundle: (blob: Blob) => Promise<Result<ProjectDocument>>;
};
const defaultScope = (document: ProjectDocument): EditScope => ({
  instanceIds: Object.keys(document.instances),
  range: { start: 0, end: document.settings.duration },
  preserveDuration: true,
  ripple: false,
});
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
export async function createOfflineDocumentStore(
  options: { storage?: BrowserStorage; initial?: ProjectDocument; evidence?: KnowledgeSnapshot } = {},
): Promise<Result<OfflineDocumentStore>> {
  try {
    const storage = options.storage ?? createBrowserStorage(),
      loaded = await storage.load();
    if (!loaded.ok) return loaded;
    let history = loaded.value ?? createHistory(options.initial ?? createStarterProject("browser-project"));
    const initial = compileProject(history.document);
    if (!initial.ok) return initial;
    if (!Array.isArray(history.past) || !Array.isArray(history.future))
      return fail("INVALID_HISTORY", "Browser recovery history is invalid");
    for (const entry of [...history.past, ...history.future])
      if (!entry || typeof entry.expectedContentHash !== "string" || !parseProject(entry.document).ok)
        return fail("INVALID_HISTORY", "Browser recovery history contains an invalid snapshot");
    const listeners = new Set<() => void>(),
      events: { revision: number; requestId: string; affectedIds: string[]; contentHash: string }[] = [];
    let tail: Promise<unknown> = Promise.resolve(),
      token = 0;
    const enqueue = <T>(work: () => Promise<Result<T>>): Promise<Result<T>> => {
      const next = tail.then(work, work);
      tail = next.catch(() => {});
      return next;
    };
    const publish = async (
      next: Result<HistoryState>,
      requestId: string,
      affectedIds: string[],
      assets: BrowserAsset[] = [],
    ): Promise<Result<OfflineReceipt>> => {
      if (!next.ok) return next;
      const saved = await storage.save(next.value, assets);
      if (!saved.ok) return saved;
      history = next.value;
      const receipt = {
        requestId,
        documentRevision: history.document.revision,
        affectedIds,
        contentHash: projectContentHash(history.document),
      };
      events.push({
        revision: receipt.documentRevision,
        requestId,
        affectedIds,
        contentHash: receipt.contentHash,
      });
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          /* A UI subscriber cannot roll back a durable commit. */
        }
      }
      return ok(receipt);
    };
    const submit = (transaction: EditTransaction, gestureId?: string) =>
      enqueue(() =>
        publish(
          commitHistory(history, transaction, { gestureId }),
          transaction?.id ?? "invalid",
          transaction?.scope?.instanceIds ?? [],
        ),
      );
    const replace = (document: ProjectDocument, assets: BrowserAsset[] = []) =>
      enqueue(async () => {
        const compiled = compileProject(document);
        if (!compiled.ok) return compiled;
        const score = validateScore(document);
        if (!score.ok) return score;
        const serialized = serializeBrowserProject(document);
        if (!serialized.ok) return serialized;
        if (Object.values(document.definitions).some((d) => !d.moduleHash.startsWith("builtin:")))
          return fail("RUNNER_REQUIRED", "Custom element projects require the local runner");
        const next = createHistory(document),
          saved = await storage.save(next, assets);
        if (!saved.ok) return saved;
        history = next;
        events.length = 0;
        for (const listener of listeners) listener();
        return ok(structuredClone(document));
      });
    const getAssetData = async (assetId: string): Promise<Result<string>> => {
      const metadata = history.document.assets[assetId];
      if (!metadata) return fail("ASSET_UNAVAILABLE", "Unknown asset", [assetId]);
      const stored = await storage.assets(history.document.id);
      if (!stored.ok) return stored;
      const asset = stored.value.find((a) => a.assetId === assetId),
        expected = object(metadata).sha256;
      if (!asset)
        return fail("ASSET_UNAVAILABLE", "Asset bytes are missing; import its portable bundle or relink it", [
          assetId,
        ]);
      if (asset.sha256 !== expected)
        return fail("ASSET_HASH_MISMATCH", "Stored asset differs from the project", [assetId]);
      const bytes = dataUrlToBytes(asset.dataUrl);
      if (!bytes.ok) return bytes;
      if ((await sha256Bytes(bytes.value)) !== expected)
        return fail("ASSET_HASH_MISMATCH", "Stored asset bytes differ from the project", [assetId]);
      return ok(asset.dataUrl);
    };
    const getOfflineProjectAssets = async (): Promise<Result<StageAssets>> => {
      const fonts: StageAssets["fonts"] = [];
      for (const [id, value] of Object.entries(history.document.assets)) {
        const asset = object(value);
        if (asset.kind !== "font") continue;
        const family = object(asset.fontMetadata).family;
        if (typeof family !== "string")
          return fail("FONT_FAMILY_REQUIRED", "Font family metadata is required", [id]);
        const url = await getAssetData(id);
        if (!url.ok) return url;
        fonts.push({ family, url: url.value });
      }
      return ok({ fonts });
    };
    const evaluate = (tick: number): Result<FramePlan> => {
      const compiled = compileProject(history.document);
      if (!compiled.ok) return compiled;
      const document = history.document;
      return evaluateFrame(compiled.value, {
        tick,
        frame: Math.floor((tick * document.settings.fps.num) / 240000),
        fps: document.settings.fps,
        seed: document.settings.seed,
        documentRevision: document.revision,
        frameToken: `offline:${document.revision}:${++token}`,
      });
    };
    const addAsset = async (
      file: Blob & { name?: string },
      requestedKind?: string,
      family?: string,
    ): Promise<
      Result<{ assetId: string; asset: ProjectDocument["assets"][string]; documentRevision: number }>
    > => {
      try {
        if (file.size > 128 * 1024 * 1024)
          return fail("ASSET_TOO_LARGE", "Browser assets are limited to 128 MiB each");
        const name = (file.name ?? "asset").split(/[\\/]/).at(-1)!,
          extension = name.includes(".") ? `.${name.split(".").at(-1)!.toLowerCase()}` : "",
          kind =
            requestedKind ??
            ([".ttf", ".otf"].includes(extension)
              ? "font"
              : [".png", ".jpg", ".jpeg", ".webp"].includes(extension)
                ? "image"
                : [".mp4", ".webm", ".mov"].includes(extension)
                  ? "video"
                  : [".wav", ".mp3", ".ogg"].includes(extension)
                    ? "audio"
                    : "unknown");
        if (!["font", "image", "video", "audio"].includes(kind))
          return fail("UNSUPPORTED_ASSET", "Unsupported browser asset type");
        const bytes = new Uint8Array(await file.arrayBuffer()),
          sha256 = await sha256Bytes(bytes),
          mimeType =
            file.type ||
            (
              {
                font: extension === ".otf" ? "font/otf" : "font/ttf",
                image:
                  extension === ".jpg" || extension === ".jpeg"
                    ? "image/jpeg"
                    : extension === ".webp"
                      ? "image/webp"
                      : "image/png",
                audio: extension === ".mp3" ? "audio/mpeg" : "audio/wav",
                video: extension === ".webm" ? "video/webm" : "video/mp4",
              } as Record<string, string>
            )[kind];
        return enqueue(async () => {
          const document = history.document,
            asset = {
              sha256,
              kind,
              logicalPath: `assets/${sha256}${/^[.][a-z0-9]+$/.test(extension) ? extension : ".bin"}`,
              ...(kind === "font"
                ? { fontMetadata: { family: family ?? name.replace(/\.[^.]+$/, "") } }
                : {}),
            },
            record: BrowserAsset = {
              projectId: document.id,
              assetId: sha256,
              name,
              mimeType,
              sha256,
              dataUrl: bytesToDataUrl(bytes, mimeType),
            },
            transaction: EditTransaction = {
              id: `asset:${sha256}:${document.revision}`,
              baseRevision: document.revision,
              author: "user",
              scope: defaultScope(document),
              commands: [{ type: "RegisterAsset", assetId: sha256, asset }],
            };
          const changed = await publish(commitHistory(history, transaction), transaction.id, [], [record]);
          return changed.ok
            ? ok({ assetId: sha256, asset, documentRevision: changed.value.documentRevision })
            : changed;
        });
      } catch (error) {
        return fail("ASSET_IMPORT_FAILED", String(error));
      }
    };
    const evidence = (body: Record<string, unknown>): EvidencePacket =>
      options.evidence
        ? queryKnowledge(options.evidence, {
            text: typeof body.text === "string" ? body.text : undefined,
            conceptIds: Array.isArray(body.conceptIds)
              ? body.conceptIds.filter((v): v is string => typeof v === "string")
              : undefined,
            limit: 3,
          })
        : { snapshotHash: "offline:unloaded", candidates: [] };
    const api = async <T>(route: string, input?: unknown): Promise<Result<T>> => {
      try {
        const body = object(input),
          name = route.replace(/^\/?api\//, "").split("?")[0];
        let result: Result<unknown>;
        switch (name) {
          case "project":
            result = ok({
              document: structuredClone(history.document),
              history: { undo: history.past.length, redo: history.future.length },
              events: structuredClone(events),
              offline: true,
            });
            break;
          case "transaction":
            result = await submit(
              body.transaction as EditTransaction,
              typeof body.gestureId === "string" ? body.gestureId : undefined,
            );
            break;
          case "undo":
          case "redo":
            result = await enqueue(() =>
              publish(
                name === "undo" ? undo(history) : redo(history),
                `${name}:${history.document.revision}`,
                Object.keys(history.document.instances),
              ),
            );
            break;
          case "context":
            result = ok(
              getContext(
                history.document,
                (body.scope ?? defaultScope(history.document)) as EditScope,
                evidence(body),
              ),
            );
            break;
          case "review":
            result = ok(reviewProject(history.document));
            break;
          case "knowledge":
            result = ok(evidence(body));
            break;
          case "recipe": {
            const planned = planPhrase(history.document, body.request as PhraseRequest);
            result = planned.ok ? await submit(planned.value) : planned;
            break;
          }
          case "patch": {
            const valid = validateChangeSet(history.document, body.change);
            result = !valid.ok
              ? valid
              : body.dryRun
                ? ok({ transaction: valid.value, baseRevision: history.document.revision })
                : await submit(valid.value);
            break;
          }
          case "variant":
            result = createVariant(history.document, body.transaction as EditTransaction);
            break;
          case "frame":
            if (body.revision !== undefined && body.revision !== history.document.revision)
              result = fail("REVISION_CONFLICT", "Refresh before evaluating a frame");
            else result = evaluate(Number(body.tick));
            break;
          case "asset-data": {
            const data = await getAssetData(String(body.assetId));
            result = data.ok ? ok({ dataUrl: data.value }) : data;
            break;
          }
          case "asset": {
            const mime = String(body.mimeType ?? "application/octet-stream"),
              decoded = dataUrlToBytes(`data:${mime};base64,${String(body.base64 ?? "")}`);
            result = decoded.ok
              ? await addAsset(
                  Object.assign(new Blob([new Uint8Array(decoded.value).buffer], { type: mime }), {
                    name: String(body.name ?? "asset"),
                  }),
                  undefined,
                  typeof body.family === "string" ? body.family : undefined,
                )
              : decoded;
            break;
          }
          case "save":
            result = await storage.save(history);
            break;
          case "render":
          case "source":
          case "audio":
          case "variant-frame":
          case "cancel":
            result = fail(
              "RUNNER_REQUIRED",
              "This action needs the local runner; browser editing remains available",
            );
            break;
          default:
            result = fail("UNSUPPORTED_OFFLINE_ROUTE", `Unsupported browser action: ${name}`);
        }
        return result as Result<T>;
      } catch (error) {
        return fail("OFFLINE_ACTION_FAILED", String(error));
      }
    };
    return ok({
      getDocument: () => structuredClone(history.document),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      api,
      getOfflineProjectAssets,
      getAssetData,
      evaluate,
      importProjectJson: async (text) => {
        try {
          const parsed = parseProject(JSON.parse(text));
          return parsed.ok ? replace(parsed.value) : parsed;
        } catch {
          return fail("INVALID_PROJECT", "Project JSON is malformed");
        }
      },
      exportProjectJson: () => serializeBrowserProject(history.document),
      addAsset,
      exportBundle: async () => {
        const assets = await storage.assets(history.document.id);
        return assets.ok ? exportBrowserBundle(history.document, assets.value) : assets;
      },
      importBundle: async (blob) => {
        const imported = await importBrowserBundle(blob);
        return imported.ok ? replace(imported.value.document, imported.value.assets) : imported;
      },
    });
  } catch (error) {
    return fail("BROWSER_STORAGE_FAILED", String(error));
  }
}
