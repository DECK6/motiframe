import { fail, ok, type Result } from "../../document/src/result";
import type { FrameContext, Instance, JsonValue, TargetAddress } from "../../document/src/schema";
import type { MotionIR } from "./compile";
import { evaluateCurve } from "./curves";
export type FrameInstance = Instance & { id: string; localTick: number; visible: boolean };
export type FramePlan = FrameContext & {
  instances: FrameInstance[];
  channelValues: { target: TargetAddress; value: JsonValue }[];
  mediaRequests: unknown[];
};
export function evaluateFrame(ir: MotionIR, context: FrameContext): Result<FramePlan> {
  if (!Number.isSafeInteger(context.tick) || context.tick < 0 || context.tick >= ir.duration)
    return fail("TIME_OUT_OF_RANGE", "Frame tick is outside the project");
  if (context.documentRevision !== ir.documentRevision)
    return fail("REVISION_CONFLICT", "Frame belongs to another document revision");
  const visible = (id: string): boolean => {
    const instance = ir.document.instances[id];
    const local = context.tick - ir.starts[id];
    return (
      local >= 0 &&
      local < instance.duration &&
      !ir.document.tracks.find((t) => t.id === instance.trackId)?.muted &&
      (!instance.parentId || visible(instance.parentId))
    );
  };
  const instances = ir.order.map((id) => ({
    ...ir.document.instances[id],
    id,
    localTick: context.tick - ir.starts[id],
    visible: visible(id),
  }));
  const channelValues: FramePlan["channelValues"] = [];
  for (const channel of Object.values(ir.document.channels)) {
    const value = evaluateCurve(channel.keys, context.tick - ir.starts[channel.target.instanceId]);
    if (!value.ok) return value;
    channelValues.push({ target: channel.target, value: value.value });
  }
  return ok({ ...context, instances, channelValues, mediaRequests: [] });
}
