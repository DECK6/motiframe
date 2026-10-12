import { z } from "zod";
import { fail, ok, type Result } from "../../document/src/result";

const tick = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .refine((value) => value % 5 === 0, "Time must align to a 48 kHz sample (5 ticks)");
const toneScoreSchema = z
  .object({
    durationTicks: tick.refine(
      (value) => value > 0 && value <= 240000 * 120,
      "Duration must be between one sample and 120 seconds",
    ),
    sampleRate: z.literal(48000).default(48000),
    startTick: tick.default(0),
    instrument: z.enum(["sine", "triangle", "square", "sawtooth", "fm"]).default("sine"),
    gainDb: z.number().min(-60).max(0).default(-12),
    attackTicks: tick.default(2400),
    releaseTicks: tick.default(14400),
    notes: z
      .array(
        z
          .object({
            at: tick,
            duration: tick.refine((value) => value > 0),
            pitch: z.union([z.number().min(20).max(20000), z.string().regex(/^[A-G](?:#|b)?[0-8]$/)]),
            velocity: z.number().min(0).max(1).default(0.8),
          })
          .strict(),
      )
      .max(512),
  })
  .strict()
  .superRefine((score, ctx) => {
    score.notes.forEach((note, index) => {
      if (note.at + note.duration + score.releaseTicks > score.durationTicks)
        ctx.addIssue({
          code: "custom",
          message: "Note and release must fit inside the audio duration",
          path: ["notes", index],
        });
      if (score.attackTicks > note.duration)
        ctx.addIssue({
          code: "custom",
          message: "Attack must fit inside the note duration",
          path: ["notes", index],
        });
    });
  });
export type ToneScore = z.input<typeof toneScoreSchema>;
export type NormalizedToneScore = z.output<typeof toneScoreSchema>;
export type RenderedToneAudio = {
  sampleRate: 48000;
  frames: number;
  channels: Float32Array[];
  wav: Uint8Array;
};
export function parseToneScore(input: unknown): Result<NormalizedToneScore> {
  const parsed = toneScoreSchema.safeParse(input);
  return parsed.success
    ? ok(parsed.data)
    : fail(
        "INVALID_TONE_SCORE",
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
}
/** Interleaved 32-bit float PCM WAV; no Node or live AudioContext dependency. */
export function encodePcmWav(channels: Float32Array[], sampleRate: number): Result<Uint8Array> {
  const frames = channels[0]?.length ?? 0;
  if (
    ![1, 2].includes(channels.length) ||
    !Number.isSafeInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000 ||
    frames === 0 ||
    channels.some((c) => c.length !== frames)
  )
    return fail("INVALID_PCM", "PCM needs one or two equally sized channels and a valid sample rate");
  if (frames * channels.length * 4 > 128 * 1024 * 1024)
    return fail("AUDIO_BUDGET_EXCEEDED", "PCM exceeds the 128 MiB budget");
  if (channels.some((channel) => channel.some((value) => !Number.isFinite(value))))
    return fail("INVALID_PCM", "PCM samples must be finite");
  const bytes = new Uint8Array(44 + frames * channels.length * 4),
    view = new DataView(bytes.buffer),
    encoder = new TextEncoder();
  const label = (at: number, value: string) => bytes.set(encoder.encode(value), at);
  label(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  label(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * 4, true);
  view.setUint16(32, channels.length * 4, true);
  view.setUint16(34, 32, true);
  label(36, "data");
  view.setUint32(40, bytes.length - 44, true);
  for (let frame = 0; frame < frames; frame++)
    for (let channel = 0; channel < channels.length; channel++)
      view.setFloat32(
        44 + (frame * channels.length + channel) * 4,
        Math.max(-1, Math.min(1, channels[channel][frame])),
        true,
      );
  return ok(bytes);
}
let renderTail: Promise<unknown> = Promise.resolve();
/** Render in a browser OfflineAudioContext. startTick only places the resulting asset in a project. */
export function renderToneScore(input: unknown): Promise<Result<RenderedToneAudio>> {
  const parsed = parseToneScore(input);
  if (!parsed.ok) return Promise.resolve(parsed);
  const run = async (): Promise<Result<RenderedToneAudio>> => {
    if (typeof globalThis.OfflineAudioContext === "undefined")
      return fail("TONE_BROWSER_REQUIRED", "Tone synthesis requires the isolated browser renderer");
    try {
      const Tone = await import("tone"),
        score = parsed.value,
        synths: { dispose: () => unknown }[] = [];
      const original = Tone.getContext();
      let rendered: Awaited<ReturnType<typeof Tone.Offline>>;
      let context: InstanceType<typeof Tone.OfflineContext> | undefined;
      try {
        // Passing an integer length avoids truncation from seconds × sample-rate rounding.
        context = new Tone.OfflineContext(
          new OfflineAudioContext(2, score.durationTicks / 5, score.sampleRate),
        );
        Tone.setContext(context);
        for (const note of score.notes) {
          const envelope = {
            attack: score.attackTicks / 240000,
            decay: 0,
            sustain: 1,
            release: score.releaseTicks / 240000,
            attackCurve: "linear" as const,
            releaseCurve: "linear" as const,
          };
          const synth =
            score.instrument === "fm"
              ? new Tone.FMSynth({
                  envelope,
                  modulationEnvelope: envelope,
                  harmonicity: 2,
                  modulationIndex: 2,
                  volume: score.gainDb,
                })
              : new Tone.Synth({ oscillator: { type: score.instrument }, envelope, volume: score.gainDb });
          synths.push(synth);
          synth.toDestination();
          synth.triggerAttackRelease(note.pitch, note.duration / 240000, note.at / 240000, note.velocity);
        }
        rendered = await context.render();
      } finally {
        Tone.setContext(original);
        for (const synth of synths) synth.dispose();
        context?.dispose();
      }
      const buffer = rendered.get();
      if (!buffer) return fail("TONE_RENDER_FAILED", "Tone returned an empty audio buffer");
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
        buffer.getChannelData(channel).slice(),
      );
      const frames = score.durationTicks / 5;
      if (buffer.length !== frames || buffer.sampleRate !== 48000)
        return fail("TONE_RENDER_FAILED", "Tone output duration or sample rate differs from the score");
      const wav = encodePcmWav(channels, score.sampleRate);
      rendered.dispose();
      return wav.ok ? ok({ sampleRate: 48000, frames, channels, wav: wav.value }) : wav;
    } catch (error) {
      return fail("TONE_RENDER_FAILED", error instanceof Error ? error.message : String(error));
    }
  };
  const rendered = renderTail.then(run, run);
  renderTail = rendered;
  return rendered;
}
