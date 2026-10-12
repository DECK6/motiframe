import { projectContentHash } from "../../../../packages/document/src/history";
import { fail, ok, type Result } from "../../../../packages/document/src/result";
import type { FrameReceipt, StagePort } from "../../../../packages/stage/src/main";
import { offlineStore } from "../state/project-store";
export class BrowserFrameRenderer {
  private loaded = "";
  constructor(private stage: StagePort) {}
  async frame(tick: number, revision: number): Promise<Result<{ image: string; receipt: FrameReceipt }>> {
    const opened = await offlineStore();
    if (!opened.ok) return opened;
    const store = opened.value,
      doc = store.getDocument();
    if (doc.revision !== revision) return fail("REVISION_CONFLICT", "Refresh before rendering");
    if (Object.values(doc.definitions).some((d) => !d.moduleHash.startsWith("builtin:")))
      return fail("RUNNER_REQUIRED", "Custom elements require the local runner");
    if (Object.keys(doc.mediaClips).length)
      return fail("RUNNER_REQUIRED", "Frame-accurate video and audio preview require the local runner");
    const key = `${doc.id}:${revision}:${projectContentHash(doc)}`;
    if (this.loaded !== key) {
      const assets = await store.getOfflineProjectAssets();
      if (!assets.ok) return assets;
      const loaded = await this.stage.load(doc, undefined, assets.value);
      if (!loaded.ok) return loaded;
      this.loaded = key;
    }
    const plan = store.evaluate(tick);
    if (!plan.ok) return plan;
    for (const instance of plan.value.instances) {
      const id = instance.props.assetId;
      if (typeof id === "string") {
        const data = await store.getAssetData(id);
        if (!data.ok) return data;
        instance.props = { ...instance.props, src: data.value };
      }
    }
    const rendered = await this.stage.renderFrame(plan.value);
    return rendered.ok ? ok({ image: "", receipt: rendered.value }) : rendered;
  }
}
