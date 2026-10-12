export type ClockSample = { tick: number; playing: boolean };
/** Timeline ticks are derived from an anchored clock, never accumulated animation-frame deltas. */
export class TransportClock {
  private tick = 0;
  private playing = false;
  private anchorTick = 0;
  private anchorMs = 0;
  private duration: number;
  private step: number;
  private lastTick: number;
  constructor(options: { duration: number; fps: { num: 24 | 30 | 60; den: 1 } }) {
    if (
      !Number.isSafeInteger(options.duration) ||
      options.duration <= 0 ||
      ![24, 30, 60].includes(options.fps.num) ||
      options.fps.den !== 1
    )
      throw new RangeError("Transport requires a positive duration and supported output fps");
    this.duration = options.duration;
    this.step = 240000 / options.fps.num;
    this.lastTick = Math.floor((this.duration - 1) / this.step) * this.step;
  }
  private snap(tick: number) {
    return Math.min(
      this.lastTick,
      Math.max(0, Math.floor((Number.isFinite(tick) ? tick : 0) / this.step) * this.step),
    );
  }
  start(tick: number, nowMs: number) {
    this.seek(tick, nowMs);
    this.playing = true;
  }
  seek(tick: number, nowMs: number) {
    this.tick = this.snap(tick);
    this.anchorTick = this.tick;
    this.anchorMs = nowMs;
  }
  pause(nowMs: number, audioSeconds?: number): ClockSample {
    this.read(nowMs, audioSeconds);
    this.playing = false;
    return { tick: this.tick, playing: false };
  }
  read(nowMs: number, audioSeconds?: number): ClockSample {
    if (!this.playing) return { tick: this.tick, playing: false };
    const source =
      audioSeconds !== undefined && Number.isFinite(audioSeconds) && audioSeconds >= 0
        ? audioSeconds * 240000
        : this.anchorTick + Math.max(0, nowMs - this.anchorMs) * 240;
    if (Number.isFinite(source)) {
      this.tick = Math.max(this.tick, this.snap(source));
      if (source >= this.duration) this.playing = false;
    }
    return { tick: this.tick, playing: this.playing };
  }
}
