import { expect, it } from "vitest";
import { TransportClock } from "../../apps/editor/src/transport/clock";

it("anchors transport to monotonic elapsed time and snaps to output frames", () => {
  const clock = new TransportClock({ duration: 1440000, fps: { num: 30, den: 1 } });
  clock.start(240000, 1000);
  expect(clock.read(1510)).toEqual({ tick: 360000, playing: true });
  expect(clock.read(1700)).toEqual({ tick: 408000, playing: true });
  expect(clock.pause(1800)).toEqual({ tick: 432000, playing: false });
  expect(clock.read(9000)).toEqual({ tick: 432000, playing: false });
  clock.start(432000, 10000);
  expect(clock.read(10200)).toEqual({ tick: 480000, playing: true });
});
it("uses audio as master, ignores backward wall time and reanchors explicit seeks", () => {
  const clock = new TransportClock({ duration: 1440000, fps: { num: 30, den: 1 } });
  clock.start(0, 1000);
  expect(clock.read(1100, 1.5)).toEqual({ tick: 360000, playing: true });
  expect(clock.read(900, 1.6)).toEqual({ tick: 384000, playing: true });
  clock.seek(80000, 2000);
  expect(clock.read(2100)).toEqual({ tick: 104000, playing: true });
});
it("stops at the last valid frame without creating an end-exclusive frame", () => {
  const clock = new TransportClock({ duration: 48000, fps: { num: 60, den: 1 } });
  clock.start(0, 0);
  expect(clock.read(200)).toEqual({ tick: 44000, playing: false });
  expect(clock.read(900)).toEqual({ tick: 44000, playing: false });
});
