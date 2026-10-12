import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename } from "node:fs/promises";
import path from "node:path";
import {
  type NormalizedToneScore,
  parseToneScore,
  type renderToneScore,
} from "../../../packages/authoring/src/tone";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import { type AssetMetadata, probeAsset } from "../../../packages/media/src/probe";
import { openStage } from "./stage-session";
export type ToneSynthesisArtifact = {
  assetId: string;
  asset: {
    sha256: string;
    logicalPath: string;
    kind: "audio";
    mediaMetadata: AssetMetadata;
    synthesis: { engine: "tone"; score: NormalizedToneScore };
  };
  score: NormalizedToneScore;
  samples: number;
  durationTicks: number;
};
export async function synthesizeToneScore(
  input: unknown,
  options: { projectDir: string; signal?: AbortSignal },
): Promise<Result<ToneSynthesisArtifact>> {
  const parsed = parseToneScore(input);
  if (!parsed.ok) return parsed;
  if (options.signal?.aborted) return fail("CANCELLED", "Tone synthesis was cancelled");
  let stage: Awaited<ReturnType<typeof openStage>> | undefined;
  try {
    stage = await openStage(1, 1, { signal: options.signal });
    const rendered = await stage.bounded(
      stage.page.evaluate(async (score) => {
        const result = await (
          window as unknown as { MotiFrameTone: { renderToneScore: typeof renderToneScore } }
        ).MotiFrameTone.renderToneScore(score);
        if (!result.ok) return result;
        let binary = "";
        for (let at = 0; at < result.value.wav.length; at += 32768)
          binary += String.fromCharCode(...result.value.wav.subarray(at, at + 32768));
        return {
          ok: true as const,
          value: { base64: btoa(binary), frames: result.value.frames, sampleRate: result.value.sampleRate },
        };
      }, parsed.value),
      60000,
    );
    if (!rendered.ok) return rendered;
    const bytes = Buffer.from(rendered.value.base64, "base64"),
      samples = parsed.value.durationTicks / 5;
    if (
      bytes.length !== 44 + samples * 8 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 16) !== "WAVEfmt " ||
      bytes.readUInt32LE(4) !== bytes.length - 8 ||
      bytes.readUInt16LE(20) !== 3 ||
      bytes.readUInt16LE(22) !== 2 ||
      bytes.readUInt32LE(24) !== 48000 ||
      bytes.readUInt32LE(40) !== samples * 8 ||
      rendered.value.frames !== samples ||
      rendered.value.sampleRate !== 48000
    )
      return fail("INVALID_SYNTHESIS_WAV", "Synthesized WAV header or sample duration is invalid");
    for (let at = 44; at < bytes.length; at += 4)
      if (!Number.isFinite(bytes.readFloatLE(at)))
        return fail("INVALID_SYNTHESIS_WAV", "Synthesized PCM contains invalid samples");
    options.signal?.throwIfAborted();
    const root = await realpath(options.projectDir),
      directory = path.join(root, "assets");
    await mkdir(directory, { recursive: true });
    if ((await lstat(directory)).isSymbolicLink())
      return fail("INVALID_ASSET_PATH", "Asset directory cannot be a symlink");
    const sha256 = createHash("sha256").update(bytes).digest("hex"),
      logicalPath = `assets/${sha256}.wav`,
      file = path.join(root, logicalPath);
    try {
      const existing = await lstat(file);
      if (!existing.isFile() || existing.isSymbolicLink())
        return fail("INVALID_ASSET_PATH", "Generated asset path is not a regular file");
      if (!(await readFile(file)).equals(bytes))
        return fail("ASSET_HASH_MISMATCH", "Existing generated asset differs from its hash");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const temporary = `${file}.${randomUUID()}.tmp`,
        handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
    }
    const metadata = await probeAsset(file, { signal: options.signal });
    if (!metadata.ok) return metadata;
    if (
      Math.round(metadata.value.duration * 48000) !== samples ||
      !metadata.value.streams.some(
        (s) => s.codec_type === "audio" && s.codec_name === "pcm_f32le" && s.sample_rate === "48000",
      )
    )
      return fail("INVALID_SYNTHESIS_WAV", "WAV media verification failed");
    return ok({
      assetId: sha256,
      asset: {
        sha256,
        logicalPath,
        kind: "audio",
        mediaMetadata: metadata.value,
        synthesis: { engine: "tone", score: parsed.value },
      },
      score: parsed.value,
      samples,
      durationTicks: parsed.value.durationTicks,
    });
  } catch (error) {
    return options.signal?.aborted
      ? fail("CANCELLED", "Tone synthesis was cancelled")
      : fail("TONE_SYNTHESIS_FAILED", error instanceof Error ? error.message : String(error));
  } finally {
    await stage?.close();
  }
}
