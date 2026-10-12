import { randomUUID } from "node:crypto";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import { parseProject } from "../../../packages/document/src/schema";
import type { FrameReceipt } from "../../../packages/stage/src/main";
import { openStage } from "./stage-session";
export type CapturedFrame = {
  png: Uint8Array;
  receipt: FrameReceipt;
  inspection: { sameDocument: boolean; kinds: string[] };
};
export async function captureProject(
  input: unknown,
  options: { tick: number },
): Promise<Result<CapturedFrame>> {
  const parsed = parseProject(input);
  if (!parsed.ok) return parsed;
  const project = parsed.value;
  if (options.tick !== 0) return fail("UNSUPPORTED_TIME", "Static capture currently requires tick zero");
  let stage: Awaited<ReturnType<typeof openStage>> | undefined;
  try {
    stage = await openStage(project.settings.width, project.settings.height);
    const loaded = await stage.page.evaluate((doc) => window.motiframe.load(doc), project);
    if (!loaded.ok) return loaded;
    const receipt = await stage.page.evaluate((ctx) => window.motiframe.renderFrame(ctx), {
      tick: 0,
      frame: 0,
      fps: project.settings.fps,
      seed: project.settings.seed,
      frameToken: randomUUID(),
      documentRevision: project.revision,
    });
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
