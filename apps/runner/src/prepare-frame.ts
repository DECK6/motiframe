import { readFile } from "node:fs/promises";
import type { MotionIR } from "../../../packages/core/src/compile";
import type { FramePlan } from "../../../packages/core/src/evaluate";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import { decodeFrame } from "../../../packages/media/src/decode-frame";
import { getSourceTick, type MediaClip } from "../../../packages/media/src/time-map";
import type { AssetFile } from "./asset-broker";
export async function prepareFrame(
  ir: MotionIR,
  plan: FramePlan,
  assets: Record<string, AssetFile>,
  options: { cacheDir?: string; signal?: AbortSignal } = {},
): Promise<Result<FramePlan>> {
  const prepared = structuredClone(plan);
  for (const instance of prepared.instances) {
    if (!instance.visible) continue;
    const clip = ir.document.mediaClips[instance.id] as MediaClip | undefined;
    const id = clip?.assetId ?? instance.props.assetId;
    if (typeof id !== "string") continue;
    const asset = assets[id];
    if (!asset) return fail("ASSET_UNAVAILABLE", "Instance asset is missing", [id]);
    if (asset.kind === "video") {
      if (!clip) return fail("MEDIA_CLIP_REQUIRED", "Video instances need a source range", [instance.id]);
      const source = getSourceTick({ ...clip, start: ir.starts[instance.id] }, plan.tick);
      if (!source.ok) return source;
      const decoded = await decodeFrame(asset.path, source.value, options);
      if (!decoded.ok) return decoded;
      instance.props.src = `data:image/png;base64,${Buffer.from(decoded.value.bitmap).toString("base64")}`;
    } else if (asset.kind === "image")
      instance.props.src = `data:image/${asset.path.toLowerCase().endsWith(".svg") ? "svg+xml" : asset.path.toLowerCase().endsWith(".jpg") ? "jpeg" : "png"};base64,${(await readFile(asset.path)).toString("base64")}`;
  }
  return ok(prepared);
}
