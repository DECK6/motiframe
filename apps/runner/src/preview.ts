import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { type FrameCacheInput, invalidateChanges, LruFrameCache } from "../../../packages/core/src/cache";
import { compileProject, type MotionIR } from "../../../packages/core/src/compile";
import { evaluateFrame } from "../../../packages/core/src/evaluate";
import { projectContentHash } from "../../../packages/document/src/history";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import type { ProjectDocument } from "../../../packages/document/src/schema";
import type { FrameReceipt } from "../../../packages/stage/src/main";
import { resolveAssets } from "./asset-broker";
import { loadDefinitionArtifacts } from "./definition-artifacts";
import { runtime } from "./environment";
import { prepareFrame } from "./prepare-frame";
import { openStage } from "./stage-session";
export type PreviewFrame = { image: string; receipt: FrameReceipt };
export class PreviewEngine {
  private stage: Awaited<ReturnType<typeof openStage>> | undefined;
  private ir: MotionIR | undefined;
  private assets: Awaited<ReturnType<typeof resolveAssets>> | undefined;
  private base: Omit<FrameCacheInput, "tick"> | undefined;
  private definitions: string[] = [];
  private stamp = "";
  private tail: Promise<unknown> = Promise.resolve();
  private cache = new LruFrameCache<PreviewFrame>({ maxEntries: 120, maxBytes: 128 * 1024 ** 2 });
  constructor(private projectDir: string) {}
  get stats() {
    return this.cache.stats;
  }
  frame(doc: ProjectDocument, tick: number): Promise<Result<PreviewFrame>> {
    const task = this.tail.then(() => this.render(doc, tick));
    this.tail = task.catch(() => {});
    return task;
  }
  private async assetStamp() {
    if (!this.assets?.ok) return "";
    const files = Object.values(this.assets.value.files).map((a) => a.path);
    for (const d of Object.values(this.ir?.document.definitions ?? {}))
      if (!d.moduleHash.startsWith("builtin:"))
        files.push(path.join(this.projectDir, "definitions", `${d.moduleHash}.js`));
    return (
      await Promise.all(
        files.map(async (f) => {
          const s = await stat(f);
          return `${s.size}:${s.mtimeMs}`;
        }),
      )
    ).join("|");
  }
  private async render(doc: ProjectDocument, tick: number): Promise<Result<PreviewFrame>> {
    try {
      const hash = projectContentHash(doc),
        stamp = await this.assetStamp();
      if (
        !this.base ||
        this.base.documentHash !== hash ||
        this.base.documentRevision !== doc.revision ||
        stamp !== this.stamp
      ) {
        const compiled = compileProject(doc);
        if (!compiled.ok) return compiled;
        const assets = await resolveAssets(doc, this.projectDir);
        if (!assets.ok) return assets;
        const definitions = await loadDefinitionArtifacts(doc, this.projectDir);
        if (!definitions.ok) return definitions;
        const next: Omit<FrameCacheInput, "tick"> = {
          projectId: doc.id,
          documentHash: hash,
          documentRevision: doc.revision,
          definitionRevisions: Object.fromEntries(
            Object.entries(doc.definitions).map(([id, d]) => [id, d.revision]),
          ),
          sourceHashes: Object.fromEntries(
            Object.entries(doc.definitions).map(([id, d]) => [id, d.moduleHash]),
          ),
          assetHashes: Object.fromEntries(Object.entries(assets.value.files).map(([id, a]) => [id, a.hash])),
          fontHashes: Object.fromEntries(
            Object.entries(assets.value.files)
              .filter(([, a]) => a.kind === "font")
              .map(([id, a]) => [id, a.hash]),
          ),
          runtimeHash: JSON.stringify((await runtime()).hashes),
          width: doc.settings.width,
          height: doc.settings.height,
          seed: doc.settings.seed,
        };
        if (this.base && this.ir)
          this.cache.rebase(this.base, next, invalidateChanges(this.ir.document, doc));
        await this.stage?.close();
        this.stage = undefined;
        this.ir = compiled.value;
        this.assets = assets;
        this.base = next;
        this.definitions = definitions.value;
        this.stamp = await this.assetStamp();
      }
      if (!this.base || !this.ir || !this.assets?.ok)
        return fail("PREVIEW_UNAVAILABLE", "Preview is not ready");
      const input = { ...this.base, tick },
        cached = this.cache.get(input);
      if (cached)
        return ok({
          ...cached,
          receipt: { ...cached.receipt, frameToken: randomUUID(), documentRevision: doc.revision },
        });
      if (!this.stage) {
        this.stage = await openStage(doc.settings.width, doc.settings.height, {
          definitions: this.definitions,
        });
        const loaded = await this.stage.bounded(
          this.stage.page.evaluate(({ doc, assets }) => window.motiframe.load(doc, undefined, assets), {
            doc,
            assets: this.assets.value.stage,
          }),
          30000,
        );
        if (!loaded.ok) {
          await this.close();
          return loaded;
        }
      }
      const context = {
        tick,
        frame: Math.floor((tick * doc.settings.fps.num) / 240000),
        fps: doc.settings.fps,
        seed: doc.settings.seed,
        frameToken: randomUUID(),
        documentRevision: doc.revision,
      };
      const evaluated = evaluateFrame(this.ir, context);
      if (!evaluated.ok) return evaluated;
      const prepared = await prepareFrame(this.ir, evaluated.value, this.assets.value.files, {
        cacheDir: path.join(this.projectDir, ".motiframe/cache"),
      });
      if (!prepared.ok) return prepared;
      const receipt = await this.stage.bounded(
        this.stage.page.evaluate((plan) => window.motiframe.renderFrame(plan), prepared.value),
      );
      if (!receipt.ok) return receipt;
      const bytes = await this.stage.bounded(this.stage.page.screenshot({ type: "png" }));
      const frame = {
        image: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
        receipt: receipt.value,
      };
      this.cache.set(input, frame, frame.image.length * 2 + JSON.stringify(receipt.value).length * 2);
      return ok(frame);
    } catch (error) {
      await this.close();
      return fail("PREVIEW_FAILED", String(error));
    }
  }
  async close() {
    await this.stage?.close();
    this.stage = undefined;
    this.ir = undefined;
    this.base = undefined;
    this.assets = undefined;
    this.cache.invalidate(() => true);
  }
}
