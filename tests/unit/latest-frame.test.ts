import { expect, it } from "vitest";
import { LatestFrameQueue } from "../../apps/editor/src/canvas/latest-frame";

it("shows completed frames during playback and collapses pending seeks to the latest tick", async () => {
  const calls: number[] = [],
    displayed: number[] = [];
  let complete: (value: number) => void = () => {};
  const queue = new LatestFrameQueue<number, number>(
    (tick) => {
      calls.push(tick);
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
    (value) => displayed.push(value),
  );
  queue.request(0);
  queue.request(8000);
  queue.request(16000);
  expect(calls).toEqual([0]);
  complete(0);
  await Promise.resolve();
  await Promise.resolve();
  expect(displayed).toEqual([0]);
  expect(calls).toEqual([0, 16000]);
  complete(16000);
  await Promise.resolve();
  expect(displayed).toEqual([0, 16000]);
  queue.dispose();
  queue.request(24000);
  expect(calls).toEqual([0, 16000]);
});
