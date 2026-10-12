import { randomUUID } from "node:crypto";
import { parseToneScore } from "../../../packages/authoring/src/tone";
import { fail, ok } from "../../../packages/document/src/result";
import type { DocumentService } from "./document-service";
import { synthesizeToneScore } from "./tone-synthesis";
export async function addToneScore(service: DocumentService, input: unknown, projectDir: string) {
  const parsed = parseToneScore(input);
  if (!parsed.ok) return parsed;
  const score = parsed.value,
    document = service.document,
    step = 240000 / document.settings.fps.num;
  const scene = Object.entries(document.scenes).find(
    ([, s]) => score.startTick >= s.start && score.startTick + score.durationTicks <= s.start + s.duration,
  );
  const track = document.tracks.find((t) => t.kind === "audio" && !t.locked),
    definition = Object.entries(document.definitions).find(([, d]) => d.moduleHash === "builtin:audio");
  if (
    !scene ||
    score.startTick % step ||
    score.durationTicks % step ||
    score.startTick + score.durationTicks > document.settings.duration
  )
    return fail("INVALID_AUDIO_RANGE", "Sound placement must fit one scene and align to project frames");
  if (!track || !definition)
    return fail("AUDIO_TRACK_REQUIRED", "An unlocked audio track and audio definition are required");
  const result = await synthesizeToneScore(score, { projectDir });
  if (!result.ok) return result;
  const id = `tone-${randomUUID()}`,
    asset = result.value;
  const receipt = await service.submit({
    id,
    baseRevision: document.revision,
    author: "user",
    scope: {
      instanceIds: [...Object.keys(document.instances), id],
      range: { start: 0, end: document.settings.duration },
      preserveDuration: true,
      ripple: false,
    },
    commands: [
      ...(document.assets[asset.assetId]
        ? []
        : [{ type: "RegisterAsset" as const, assetId: asset.assetId, asset: asset.asset }]),
      {
        type: "AddInstance",
        instanceId: id,
        sceneId: scene[0],
        instance: {
          definitionId: definition[0],
          definitionRevision: definition[1].revision,
          trackId: track.id,
          parentId: null,
          slotId: null,
          start: score.startTick - scene[1].start,
          duration: score.durationTicks,
          props: {},
          locked: false,
        },
      },
      {
        type: "SetMediaClip",
        instanceId: id,
        clip: {
          assetId: asset.assetId,
          sourceIn: 0,
          sourceOut: score.durationTicks,
          rate: { num: 1, den: 1 },
          gain: 1,
        },
      },
    ],
  });
  return receipt.ok
    ? ok({
        ...receipt.value,
        assetId: asset.assetId,
        instanceId: id,
        samples: asset.samples,
        durationTicks: score.durationTicks,
      })
    : receipt;
}
