import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { evaluateCurve } from "../../core/src/curves";
import { fail, ok, type Result } from "../../document/src/result";
import type { ProjectDocument } from "../../document/src/schema";
import { resolveAssetFile } from "./assets";
import { probeAsset } from "./probe";
import { mediaFailure, runMediaProcess } from "./process";
import { getSourceTick, isTick, type MediaClip } from "./time-map";

export type AudioArtifact = { path: string; start: number; end: number };
export function encodeFloatWav(samples: Float32Array, channels = 2): Buffer {
  const data = Buffer.alloc(44 + samples.length * 4);
  data.write("RIFF");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(3, 20);
  data.writeUInt16LE(channels, 22);
  data.writeUInt32LE(48000, 24);
  data.writeUInt32LE(48000 * channels * 4, 28);
  data.writeUInt16LE(channels * 4, 32);
  data.writeUInt16LE(32, 34);
  data.write("data", 36);
  data.writeUInt32LE(samples.length * 4, 40);
  for (let i = 0; i < samples.length; i++)
    data.writeFloatLE(Math.max(-1, Math.min(1, samples[i])), 44 + i * 4);
  return data;
}
export async function mixAudio(
  doc: ProjectDocument,
  range: { start: number; end: number },
  options: { projectDir: string; outputPath: string; signal?: AbortSignal },
): Promise<Result<AudioArtifact>> {
  if (options.signal?.aborted) return fail("CANCELLED", "Media operation was cancelled");
  if (
    !isTick(range.start) ||
    !isTick(range.end) ||
    range.end <= range.start ||
    range.end > doc.settings.duration
  )
    return fail("INVALID_AUDIO_RANGE", "Audio range must be within the project");
  if (range.start % 5 || range.end % 5)
    return fail("AUDIO_SAMPLE_ALIGNMENT", "Audio range must align to 48 kHz samples (5 ticks)");
  const count = (range.end - range.start) / 5;
  if (count * 8 > 128 * 1024 ** 2)
    return fail("MEDIA_BUDGET_EXCEEDED", "Audio range exceeds the 128 MiB mix budget");
  try {
    const mixed = new Float32Array(count * 2),
      decoded = new Map<string, Buffer>();
    for (const [id, rawClip] of Object.entries(doc.mediaClips)) {
      if (options.signal?.aborted) return fail("CANCELLED", "Media operation was cancelled");
      if (!rawClip || typeof rawClip !== "object" || Array.isArray(rawClip))
        return fail("INVALID_MEDIA_CLIP", "Media clip must be an object", [id]);
      const clip = rawClip as unknown as MediaClip,
        instance = doc.instances[id];
      if (!instance) return fail("INVALID_MEDIA_CLIP", "Media clip has no instance", [id]);
      let start = instance.start,
        activeStart = start,
        activeEnd = start + instance.duration,
        parent = instance.parentId;
      let muted = doc.tracks.some((t) => t.id === instance.trackId && t.muted);
      const seen = new Set([id]);
      let rootId = id;
      while (parent) {
        if (seen.has(parent) || !doc.instances[parent])
          return fail("INVALID_MEDIA_CLIP", "Invalid parent tree", [id]);
        seen.add(parent);
        rootId = parent;
        const ancestor = doc.instances[parent];
        start += ancestor.start;
        activeStart += ancestor.start;
        activeEnd += ancestor.start;
        activeStart = Math.max(activeStart, ancestor.start);
        activeEnd = Math.min(activeEnd, ancestor.start + ancestor.duration);
        muted ||= doc.tracks.some((t) => t.id === ancestor.trackId && t.muted);
        parent = ancestor.parentId;
      }
      const scenes = Object.values(doc.scenes).filter((scene) => scene.rootIds.includes(rootId));
      if (scenes.length !== 1) return fail("SCENE_ROOT", "Media root must belong to one scene", [id]);
      start += scenes[0].start;
      activeStart += scenes[0].start;
      activeEnd += scenes[0].start;
      if (muted || activeEnd <= range.start || activeStart >= range.end) continue;
      const time = getSourceTick({ ...clip, start }, start);
      if (!time.ok) return time;
      if (!Number.isFinite(clip.gain) || clip.gain < 0)
        return fail("INVALID_MEDIA_CLIP", "Clip gain must be finite and nonnegative", [id]);
      if ([start, activeStart, activeEnd, clip.sourceIn, clip.sourceOut].some((t) => t % 5))
        return fail("AUDIO_SAMPLE_ALIGNMENT", "Audio clips must align to 48 kHz samples", [id]);
      const file = await resolveAssetFile(doc.assets[clip.assetId], options.projectDir, options.signal);
      if (!file.ok) return file;
      const metadata = await probeAsset(file.value, { signal: options.signal });
      if (!metadata.ok) return metadata;
      if (!metadata.value.streams.some((s) => s.codec_type === "audio")) continue;
      if (clip.rate.num !== clip.rate.den)
        return fail("UNSUPPORTED_AUDIO_RATE", "Audio currently supports rate 1 only", [id]);

      if (clip.sourceOut > Math.round(metadata.value.duration * 240000) + 5)
        return fail("SOURCE_OUT_OF_RANGE", "Audio source out exceeds its duration", [id]);
      let pcm = decoded.get(file.value);
      if (!pcm) {
        const result = await runMediaProcess(
          "ffmpeg",
          [
            "-v",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            file.value,
            "-map",
            "0:a:0",
            "-f",
            "f32le",
            "-ac",
            "2",
            "-ar",
            "48000",
            "pipe:1",
          ],
          options.signal,
        );
        if (!result.ok) return result;
        pcm = result.value;
        decoded.set(file.value, pcm);
      }
      const gains = Object.values(doc.channels).filter(
        (c) => c.target.instanceId === id && ["gain", "audio.gain"].includes(c.target.channel),
      );
      const from = Math.max(range.start, activeStart),
        to = Math.min(range.end, activeEnd, start + clip.sourceOut - clip.sourceIn);
      for (let tick = from; tick < to; tick += 5) {
        if ((tick - from) % 81920 === 0) {
          await setImmediate();
          if (options.signal?.aborted) return fail("CANCELLED", "Media operation was cancelled");
        }
        let gain = clip.gain;
        for (const channel of gains) {
          const value = evaluateCurve(channel.keys, tick - start);
          if (!value.ok) return value;
          if (typeof value.value !== "number" || value.value < 0 || !Number.isFinite(value.value))
            return fail("INVALID_AUDIO_GAIN", "Audio gain channels must be finite nonnegative numbers", [id]);
          gain *= value.value;
        }
        const source = (clip.sourceIn + tick - start) / 5,
          output = (tick - range.start) / 5;
        if ((source + 1) * 8 > pcm.length) continue;
        mixed[output * 2] += pcm.readFloatLE(source * 8) * gain;
        mixed[output * 2 + 1] += pcm.readFloatLE(source * 8 + 4) * gain;
      }
    }
    if (options.signal?.aborted) return fail("CANCELLED", "Media operation was cancelled");
    const output = path.resolve(options.outputPath);
    await mkdir(path.dirname(output), { recursive: true });
    const temporary = `${output}.${randomUUID()}.tmp`;
    await writeFile(temporary, encodeFloatWav(mixed));
    if (options.signal?.aborted) return fail("CANCELLED", "Media operation was cancelled");
    await rename(temporary, output);
    return ok({ path: output, start: range.start, end: range.end });
  } catch (error) {
    return options.signal?.aborted ? fail("CANCELLED", "Media operation was cancelled") : mediaFailure(error);
  }
}
