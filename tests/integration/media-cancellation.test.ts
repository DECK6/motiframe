import { expect, it } from "vitest";
import { runMediaProcess } from "../../packages/media/src/process";

it("cancels an active FFmpeg child and waits for its exit within one second", async () => {
  const abort = new AbortController();
  const running = runMediaProcess(
    "ffmpeg",
    ["-v", "error", "-re", "-f", "lavfi", "-i", "testsrc2=size=64x48:duration=60", "-f", "null", "-"],
    abort.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const start = performance.now();
  abort.abort();
  expect(await running).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  expect(performance.now() - start).toBeLessThan(1000);
});
