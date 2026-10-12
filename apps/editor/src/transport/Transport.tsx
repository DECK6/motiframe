import { useEffect, useRef, useState } from "react";
import type { FrameRate } from "../../../../packages/document/src/schema";
import { TransportClock } from "./clock";
export type TransportProps = {
  tick: number;
  duration: number;
  fps: FrameRate;
  onTick: (tick: number) => void;
  audioMaster?: () => number | undefined;
  audio?: HTMLAudioElement | null;
  toggleSignal?: number;
  onPlayingChange?: (playing: boolean) => void;
  onError?: (message: string) => void;
};
export default function Transport(props: TransportProps) {
  const { tick, duration, fps, audio, audioMaster } = props;
  const [playing, setPlaying] = useState(false),
    clock = useRef(new TransportClock({ duration, fps })),
    lastEmitted = useRef(tick),
    latest = useRef(props),
    intent = useRef(0),
    lastToggle = useRef(props.toggleSignal);
  latest.current = props;
  const step = 240000 / fps.num,
    lastTick = Math.floor((duration - 1) / step) * step;
  const emit = (next: number) => {
    lastEmitted.current = next;
    latest.current.onTick(next);
  };
  const publishPlaying = (value: boolean) => {
    setPlaying(value);
    latest.current.onPlayingChange?.(value);
  };
  const master = () => (audio && !audio.paused ? audio.currentTime : audioMaster?.());
  const pause = () => {
    intent.current++;
    const sample = clock.current.pause(performance.now(), master());
    audio?.pause();
    emit(sample.tick);
    publishPlaying(false);
  };
  const play = () => {
    const next = tick >= lastTick ? 0 : tick;
    clock.current.start(next, performance.now());
    emit(next);
    publishPlaying(true);
    const token = ++intent.current;
    if (audio) {
      audio.currentTime = next / 240000;
      void audio.play().catch((error) => {
        if (token !== intent.current) return;
        pause();
        latest.current.onError?.(
          `Audio playback failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  };
  const toggle = () => (playing ? pause() : play());
  const seek = (next: number) => {
    clock.current.seek(next, performance.now());
    const sample = clock.current.read(performance.now());
    emit(sample.tick);
    if (audio) audio.currentTime = sample.tick / 240000;
  };
  useEffect(() => {
    clock.current = new TransportClock({ duration, fps });
    clock.current.seek(latest.current.tick, performance.now());
    intent.current++;
    audio?.pause();
    publishPlaying(false);
  }, [duration, fps.num, fps.den, audio]);
  useEffect(() => {
    if (tick !== lastEmitted.current) {
      clock.current.seek(tick, performance.now());
      lastEmitted.current = tick;
      if (audio) audio.currentTime = tick / 240000;
    }
  }, [tick, audio]);
  useEffect(() => {
    if (lastToggle.current !== props.toggleSignal) {
      lastToggle.current = props.toggleSignal;
      toggle();
    }
  }, [props.toggleSignal]);
  useEffect(() => {
    if (!playing) return;
    let request = 0;
    const update = () => {
      const sample = clock.current.read(performance.now(), master());
      if (sample.tick !== lastEmitted.current) emit(sample.tick);
      if (!sample.playing || audio?.ended) {
        audio?.pause();
        publishPlaying(false);
        return;
      }
      request = requestAnimationFrame(update);
    };
    request = requestAnimationFrame(update);
    return () => cancelAnimationFrame(request);
  }, [playing, audio, audioMaster]);
  useEffect(
    () => () => {
      intent.current++;
      audio?.pause();
    },
    [audio],
  );
  return (
    <div className="transport" aria-label="Playback controls">
      <button
        type="button"
        aria-label="Go to start"
        onClick={() => {
          pause();
          seek(0);
        }}
      >
        ↤
      </button>
      <button
        type="button"
        aria-label="Previous frame"
        onClick={() => {
          pause();
          seek(tick - step);
        }}
      >
        ‹
      </button>
      <button
        type="button"
        className={playing ? "" : "primary"}
        aria-label={playing ? "Pause" : "Play"}
        aria-pressed={playing}
        onClick={toggle}
      >
        {playing ? "Ⅱ" : "▶"}
      </button>
      <button
        type="button"
        aria-label="Next frame"
        onClick={() => {
          pause();
          seek(tick + step);
        }}
      >
        ›
      </button>
      <output className="time-readout" aria-live="off">
        {(tick / 240000).toFixed(2)} / {(duration / 240000).toFixed(2)} s
      </output>
      <input
        aria-label="Playhead"
        type="range"
        min={0}
        max={lastTick}
        step={step}
        value={Math.min(tick, lastTick)}
        onChange={(event) => seek(Number(event.currentTarget.value))}
      />
      <span className="badge">{fps.num} fps</span>
    </div>
  );
}
