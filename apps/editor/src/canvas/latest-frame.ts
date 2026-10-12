export class LatestFrameQueue<T, R> {
  private pending: { input: T } | undefined;
  private active = false;
  private closed = false;
  constructor(
    private render: (input: T) => Promise<R>,
    private receive: (result: R, input: T) => void,
  ) {}
  request(input: T) {
    if (this.closed) return;
    this.pending = { input };
    if (!this.active) void this.pump();
  }
  private async pump() {
    this.active = true;
    try {
      while (this.pending && !this.closed) {
        const { input } = this.pending;
        this.pending = undefined;
        const result = await this.render(input);
        if (!this.closed) this.receive(result, input);
      }
    } finally {
      this.active = false;
    }
  }
  dispose() {
    this.closed = true;
    this.pending = undefined;
  }
}
