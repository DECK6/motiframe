import { z } from "zod";
import { fail, ok, type Result } from "./result";
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const frameRateSchema = z.object({
  num: z.union([z.literal(24), z.literal(30), z.literal(60)]),
  den: z.literal(1),
});
export type FrameRate = z.infer<typeof frameRateSchema>;
export type FrameContext = {
  tick: number;
  frame: number;
  fps: FrameRate;
  seed: number;
  frameToken: string;
  documentRevision: number;
};
export const targetSchema = z.object({
  key: z.string().min(1),
  channels: z.array(z.string()),
  coordinateSpace: z.literal("local"),
});
export const manifestSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  kind: z.enum(["react", "html"]),
  moduleHash: z.string(),
  propsSchema: z.record(z.string(), z.json()),
  targets: z.array(targetSchema),
  slots: z.array(z.object({ id: z.string() })),
  assets: z.array(z.string()),
});
export type ElementManifest = z.infer<typeof manifestSchema>;
export const keyframeSchema = z.object({
  id: z.string(),
  at: tick,
  value: z.json(),
  interpolation: z.enum(["hold", "linear", "cubic"]),
  out: z.tuple([z.number(), z.number()]).optional(),
  in: z.tuple([z.number(), z.number()]).optional(),
});
export type Keyframe = z.infer<typeof keyframeSchema>;
export const targetAddressSchema = z.object({
  instanceId: z.string(),
  targetKey: z.string(),
  channel: z.string(),
});
export type TargetAddress = z.infer<typeof targetAddressSchema>;
export const channelSchema = z.object({
  target: targetAddressSchema,
  owner: z.enum(["manual", "recipe"]),
  recipeId: z.string().optional(),
  locked: z.boolean(),
  keys: z.array(keyframeSchema),
});
export type Channel = z.infer<typeof channelSchema>;
export const instanceSchema = z.object({
  definitionId: z.string(),
  definitionRevision: z.number().int().positive(),
  parentId: z.string().nullable(),
  slotId: z.string().nullable(),
  trackId: z.string(),
  start: tick,
  duration: tick.refine((x) => x > 0),
  props: z.record(z.string(), z.json()),
  locked: z.boolean(),
});
export type Instance = z.infer<typeof instanceSchema>;
export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  revision: tick,
  settings: z.object({
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    fps: frameRateSchema,
    duration: tick.refine((x) => x > 0),
    ticksPerSecond: z.literal(240000),
    seed: z.number().int(),
    colorSpace: z.literal("srgb"),
    sampleRate: z.literal(48000),
  }),
  definitions: z.record(z.string(), manifestSchema),
  scenes: z.record(z.string(), z.object({ start: tick, duration: tick, rootIds: z.array(z.string()) })),
  instances: z.record(z.string(), instanceSchema),
  tracks: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["graphics", "video", "audio"]),
      instanceIds: z.array(z.string()),
      locked: z.boolean(),
      muted: z.boolean(),
    }),
  ),
  channels: z.record(z.string(), channelSchema),
  assets: z.record(z.string(), z.json()),
  mediaClips: z.record(z.string(), z.json()),
  score: z.object({
    phrases: z.array(z.json()),
    events: z.array(z.json()),
    windows: z.array(z.json()),
    tensions: z.array(z.json()),
    handoffs: z.array(z.json()),
  }),
  references: z.array(z.json()),
  provenance: z.object({ runtime: z.string(), sdk: z.string(), sources: z.array(z.string()) }),
});
export type ProjectDocument = z.infer<typeof projectSchema>;
export function parseProject(input: unknown): Result<ProjectDocument> {
  const r = projectSchema.safeParse(input);
  return r.success
    ? ok(r.data)
    : fail("INVALID_PROJECT", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
}
