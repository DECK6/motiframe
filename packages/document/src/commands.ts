import type { DefinitionRevisionCommand } from "./definition-commands";
import type { Channel, Instance, JsonValue, Keyframe, ProjectDocument, TargetAddress } from "./schema";
export type TickRange = { start: number; end: number };
export type EditScope = {
  instanceIds: string[];
  range: TickRange;
  preserveDuration: boolean;
  ripple: boolean;
};
export type EditCommand =
  | { type: "SetMediaClip"; instanceId: string; clip: JsonValue }
  | DefinitionRevisionCommand
  | { type: "SetTrackMuted"; trackId: string; muted: boolean }
  | { type: "RegisterAsset"; assetId: string; asset: JsonValue }
  | { type: "UpdateSettings"; settings: Partial<ProjectDocument["settings"]> }
  | { type: "AddInstance"; instanceId: string; instance: Instance; sceneId?: string; index?: number }
  | { type: "RemoveInstance"; instanceId: string }
  | {
      type: "MoveInstance";
      instanceId: string;
      start: number;
      trackId?: string;
      parentId?: string | null;
      slotId?: string | null;
      sceneId?: string;
    }
  | { type: "TrimClip"; instanceId: string; start: number; duration: number }
  | { type: "SplitClip"; instanceId: string; at: number; newInstanceId: string }
  | { type: "DuplicateInstance"; instanceId: string; newInstanceId: string; start?: number }
  | { type: "ReorderTrack"; trackId: string; index: number }
  | { type: "SetProps"; instanceId: string; props: Instance["props"]; replace?: boolean }
  | {
      type: "SetKeyframe";
      channelId: string;
      target?: TargetAddress;
      owner?: Channel["owner"];
      recipeId?: string;
      key: Keyframe;
    }
  | { type: "RemoveKeyframe"; channelId: string; keyId: string }
  | { type: "SetLock"; instanceId?: string; channelId?: string; trackId?: string; locked: boolean }
  | { type: "SetChannelOwner"; channelId: string; owner: Channel["owner"]; recipeId?: string }
  | { type: "UpdateScore"; score: Partial<ProjectDocument["score"]> }
  | { type: "SetReference"; reference: JsonValue; referenceId?: string; remove?: boolean };
export type EditTransaction = {
  id: string;
  baseRevision: number;
  author: "user" | "agent" | "recipe";
  scope: EditScope;
  commands: EditCommand[];
};
export type TransactionInverse = { document: ProjectDocument; expectedContentHash: string };

// External CLI/agent input uses the same strict union as the interactive editor.
import { z } from "zod";
import { instanceSchema, keyframeSchema, manifestSchema, projectSchema, targetAddressSchema } from "./schema";

const commandId = z.string().min(1);
const commandTick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const commandRange = z
  .object({ start: commandTick, end: commandTick })
  .strict()
  .refine((r) => r.end > r.start);
const definitionRefSchema = z
  .object({
    definitionId: commandId,
    revision: z.number().int().positive(),
    instanceIds: z.array(commandId).optional(),
  })
  .strict();
export const editCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SetMediaClip"), instanceId: commandId, clip: z.json() }).strict(),
  z
    .object({
      type: z.literal("AddInstance"),
      instanceId: commandId,
      instance: instanceSchema.strict(),
      sceneId: commandId.optional(),
      index: commandTick.optional(),
    })
    .strict(),
  z.object({ type: z.literal("RemoveInstance"), instanceId: commandId }).strict(),
  z
    .object({
      type: z.literal("MoveInstance"),
      instanceId: commandId,
      start: commandTick,
      trackId: commandId.optional(),
      parentId: commandId.nullable().optional(),
      slotId: commandId.nullable().optional(),
      sceneId: commandId.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("TrimClip"),
      instanceId: commandId,
      start: commandTick,
      duration: commandTick.refine((n) => n > 0),
    })
    .strict(),
  z
    .object({
      type: z.literal("SplitClip"),
      instanceId: commandId,
      at: commandTick,
      newInstanceId: commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal("DuplicateInstance"),
      instanceId: commandId,
      newInstanceId: commandId,
      start: commandTick.optional(),
    })
    .strict(),
  z.object({ type: z.literal("ReorderTrack"), trackId: commandId, index: commandTick }).strict(),
  z
    .object({
      type: z.literal("SetProps"),
      instanceId: commandId,
      props: z.record(z.string(), z.json()),
      replace: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("SetKeyframe"),
      channelId: commandId,
      target: targetAddressSchema.strict().optional(),
      owner: z.enum(["manual", "recipe"]).optional(),
      recipeId: commandId.optional(),
      key: keyframeSchema.strict(),
    })
    .strict(),
  z.object({ type: z.literal("RemoveKeyframe"), channelId: commandId, keyId: commandId }).strict(),
  z
    .object({
      type: z.literal("SetLock"),
      instanceId: commandId.optional(),
      channelId: commandId.optional(),
      trackId: commandId.optional(),
      locked: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("SetChannelOwner"),
      channelId: commandId,
      owner: z.enum(["manual", "recipe"]),
      recipeId: commandId.optional(),
    })
    .strict(),
  z.object({ type: z.literal("UpdateScore"), score: projectSchema.shape.score.partial().strict() }).strict(),
  z
    .object({
      type: z.literal("SetReference"),
      reference: z.json(),
      referenceId: commandId.optional(),
      remove: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal("SetTrackMuted"), trackId: commandId, muted: z.boolean() }).strict(),
  z.object({ type: z.literal("RegisterAsset"), assetId: commandId, asset: z.json() }).strict(),
  z
    .object({ type: z.literal("UpdateSettings"), settings: projectSchema.shape.settings.partial().strict() })
    .strict(),
  z
    .object({
      type: z.literal("ApplyDefinitionRevision"),
      oldRef: definitionRefSchema,
      artifact: z.object({ manifest: manifestSchema.strict(), moduleHash: commandId }).strict(),
      instanceIds: z.array(commandId).min(1),
      targetRemap: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
]);
export const editTransactionSchema = z
  .object({
    id: commandId,
    baseRevision: commandTick,
    author: z.enum(["user", "agent", "recipe"]),
    scope: z
      .object({
        instanceIds: z.array(commandId),
        range: commandRange,
        preserveDuration: z.boolean(),
        ripple: z.boolean(),
      })
      .strict(),
    commands: z.array(editCommandSchema),
  })
  .strict();
