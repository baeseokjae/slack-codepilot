import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

/** Deferred promise helper — lets a test externally resolve or reject a pending fn. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('RateLimiter', () => {
  // ─── Test 1: single call success ───────────────────────────────────────────
  it('should return the result of fn', async () => {
    const limiter = new RateLimiter({ concurrency: 1, minTimeMs: 0 });

    const result = await limiter.execute(() => Promise.resolve(42));

    expect(result).toBe(42);
  });

  // ─── Test 2: concurrency=1 → serial execution ──────────────────────────────
  it('should serialize calls when concurrency=1', async () => {
    const limiter = new RateLimiter({ concurrency: 1, minTimeMs: 0 });

    const order: number[] = [];
    const d0 = deferred<number>();
    const d1 = deferred<number>();

    // Start both execute() calls concurrently — neither is awaited yet.
    const p0 = limiter.execute(() => {
      order.push(0);
      return d0.promise;
    });
    const p1 = limiter.execute(() => {
      order.push(1);
      return d1.promise;
    });

    // Yield to the microtask queue so both execute() calls have a chance to enter acquire().
    await Promise.resolve();

    // Only the first fn should have started (concurrency=1).
    expect(order).toEqual([0]);

    // Resolve the first fn, which should unblock the second.
    d0.resolve(10);
    await p0;

    // Give the queue handler a microtask tick to kick off the second fn.
    await Promise.resolve();

    expect(order).toEqual([0, 1]);

    d1.resolve(20);
    const result1 = await p1;
    expect(result1).toBe(20);
  });

  // ─── Test 3: concurrency=2 → third call waits ──────────────────────────────
  it('should allow up to concurrency simultaneous calls and queue the rest', async () => {
    const limiter = new RateLimiter({ concurrency: 2, minTimeMs: 0 });

    const started: number[] = [];
    const d = [deferred<number>(), deferred<number>(), deferred<number>()];

    const promises = d.map((def, idx) =>
      limiter.execute(() => {
        started.push(idx);
        return def.promise;
      }),
    );

    // Yield so all three execute() calls attempt acquire().
    await Promise.resolve();

    // Only the first two should have started (concurrency=2).
    expect(started).toEqual([0, 1]);

    // Resolve the first fn → third should now start.
    d[0].resolve(0);
    await promises[0];

    await Promise.resolve();

    expect(started).toEqual([0, 1, 2]);

    d[1].resolve(1);
    d[2].resolve(2);
    await Promise.all([promises[1], promises[2]]);
  });

  // ─── Test 4: minTimeMs interval ────────────────────────────────────────────
  it('should enforce minTimeMs between consecutive calls', async () => {
    const minTimeMs = 50;
    const limiter = new RateLimiter({ concurrency: 1, minTimeMs });

    const timestamps: number[] = [];

    // Run two sequential calls and record the wall-clock time each fn actually starts.
    await limiter.execute(async () => {
      timestamps.push(Date.now());
    });

    await limiter.execute(async () => {
      timestamps.push(Date.now());
    });

    expect(timestamps).toHaveLength(2);
    const gap = timestamps[1] - timestamps[0];
    // Allow a small margin below due to timer precision, but the delay must be substantial.
    expect(gap).toBeGreaterThanOrEqual(minTimeMs - 5);
  }, 2000);

  // ─── Test 5: error propagation + running counter decremented ───────────────
  it('should propagate errors from fn and keep the limiter usable', async () => {
    const limiter = new RateLimiter({ concurrency: 1, minTimeMs: 0 });

    await expect(limiter.execute(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    // The running counter must have been decremented, so a subsequent call works.
    const result = await limiter.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  // ─── Test 6: queued tasks still run after an error ─────────────────────────
  it('should execute queued tasks even when the current fn throws', async () => {
    const limiter = new RateLimiter({ concurrency: 1, minTimeMs: 0 });

    const d = deferred<void>();

    // First fn blocks until we externally reject it.
    const p0 = limiter.execute(() => d.promise);

    // Queue a second fn while the first is still running.
    const p1 = limiter.execute(() => Promise.resolve('queued'));

    // Yield so both execute() calls enter acquire(); p1 will be queued.
    await Promise.resolve();

    // Reject the first fn.
    d.reject(new Error('first failed'));
    await expect(p0).rejects.toThrow('first failed');

    // The second fn should now run and resolve successfully.
    const result = await p1;
    expect(result).toBe('queued');
  });
});
