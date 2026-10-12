import { spawn } from "node:child_process";
import { fail, ok, type Result } from "../../document/src/result";

/** Run only fixed executable names and argv; cancellation waits for the child to exit. */
export function runMediaProcess(
  command: "ffmpeg" | "ffprobe",
  args: string[],
  signal?: AbortSignal,
  maxBytes = 128 * 1024 * 1024,
): Promise<Result<Buffer>> {
  if (signal?.aborted) return Promise.resolve(fail("CANCELLED", "Media operation was cancelled"));
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0,
      stderr = "",
      exceeded = false;
    const abort = () => {
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (data: Buffer) => {
      size += data.length;
      if (size > maxBytes) {
        exceeded = true;
        child.kill("SIGKILL");
      } else chunks.push(data);
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-8000);
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      resolve(fail("MEDIA_PROCESS", error.message));
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) resolve(fail("CANCELLED", "Media operation was cancelled"));
      else if (exceeded)
        resolve(fail("MEDIA_BUDGET_EXCEEDED", "Media process output exceeded the memory budget"));
      else if (code !== 0) resolve(fail("MEDIA_PROCESS", stderr || `${command} exited with ${code}`));
      else resolve(ok(Buffer.concat(chunks)));
    });
    if (signal?.aborted) abort();
  });
}
export function mediaFailure(error: unknown): Result<never> {
  return fail("MEDIA_IO", error instanceof Error ? error.message : String(error));
}
