export class FrameBarrier {
  private current: AbortController | undefined;
  begin(): AbortSignal {
    this.current?.abort(new Error("STALE_FRAME"));
    this.current = new AbortController();
    return this.current.signal;
  }
  cancel(reason = "CANCELLED") {
    this.current?.abort(new Error(reason));
  }
}
export function untilReady<T>(work: Promise<T>, signal: AbortSignal, timeout = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason ?? new Error("CANCELLED"));
    };
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      cleanup();
      reject(new Error("FRAME_TIMEOUT"));
    }, timeout);
    work.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
