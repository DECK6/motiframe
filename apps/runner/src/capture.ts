import { randomUUID } from "node:crypto";
import { compileProject } from "../../../packages/core/src/compile";
import { evaluateFrame } from "../../../packages/core/src/evaluate";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import type { FrameReceipt } from "../../../packages/stage/src/main";
import { resolveAssets } from "./asset-broker";
import { loadDefinitionArtifacts } from "./definition-artifacts";
import { prepareFrame } from "./prepare-frame";
import { openStage } from "./stage-session";
export type CapturedFrame = {
  png: Uint8Array;
  receipt: FrameReceipt;
  inspection: { sameDocument: boolean; kinds: string[] };
};
export async function captureProject(
  input: unknown,
  options: { tick: number; projectDir?: string; signal?: AbortSignal },
): Promise<Result<CapturedFrame>> {
  const parsed = compileProject(input);
  if (!parsed.ok) return parsed;
  const project = parsed.value.document;
  const evaluated = evaluateFrame(parsed.value, {
    tick: options.tick,
    frame: Math.floor((options.tick * project.settings.fps.num) / 240000),
    fps: project.settings.fps,
    seed: project.settings.seed,
    frameToken: randomUUID(),
    documentRevision: project.revision,
  });
  if (!evaluated.ok) return evaluated;
  let stage: Awaited<ReturnType<typeof openStage>> | undefined;
  try {
    const assets = await resolveAssets(project, options.projectDir ?? process.cwd());
    if (!assets.ok) return assets;
    const prepared = await prepareFrame(parsed.value, evaluated.value, assets.value.files, {
      signal: options.signal,
    });
    if (!prepared.ok) return prepared;
    const definitions = await loadDefinitionArtifacts(project, options.projectDir ?? process.cwd());
    if (!definitions.ok) return definitions;
    stage = await openStage(project.settings.width, project.settings.height, {
      definitions: definitions.value,
      signal: options.signal,
    });
    const loaded = await stage.bounded(
      stage.page.evaluate(({ doc, assets }) => window.motiframe.load(doc, undefined, assets), {
        doc: project,
        assets: assets.value.stage,
      }),
      30000,
    );
    if (!loaded.ok) return loaded;
    const receipt = await stage.bounded(
      stage.page.evaluate((plan) => window.motiframe.renderFrame(plan), prepared.value),
    );
    if (!receipt.ok) return receipt;
    const inspection = await stage.page.evaluate(() => {
      const roots = [...document.querySelectorAll<HTMLElement>("[data-instance]")];
      return {
        sameDocument: roots.every((r) => r.ownerDocument === document),
        kinds: roots.map((r) => r.dataset.authoring ?? ""),
      };
    });
    const png = await stage.page.screenshot({ type: "png" });
    return ok({ png, receipt: receipt.value, inspection });
  } catch (error) {
    return fail("RENDER_FAILED", error instanceof Error ? error.message : String(error));
  } finally {
    await stage?.close();
  }
}
