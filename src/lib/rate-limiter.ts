interface RateLimiterOptions {
  concurrency: number; // 동시 실행 최대 수
  minTimeMs: number; // 호출 간 최소 간격 (ms)
}

export class RateLimiter {
  private running = 0;
  private queue: Array<() => void> = [];
  private lastCallTime = 0;

  constructor(private readonly options: RateLimiterOptions) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      const tryRun = () => {
        if (this.running < this.options.concurrency) {
          this.running++;
          const now = Date.now();
          const elapsed = now - this.lastCallTime;
          const waitTime = Math.max(0, this.options.minTimeMs - elapsed);
          this.lastCallTime = now + waitTime;

          if (waitTime > 0) {
            setTimeout(resolve, waitTime);
          } else {
            resolve();
          }
        } else {
          this.queue.push(tryRun);
        }
      };
      tryRun();
    });
  }

  private release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}
