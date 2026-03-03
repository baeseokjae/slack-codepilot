import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_MS = 10_000;

function makeBreaker(): CircuitBreaker {
  return new CircuitBreaker({
    name: 'test',
    failureThreshold: FAILURE_THRESHOLD,
    resetTimeoutMs: RESET_TIMEOUT_MS,
  });
}

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('closed 상태에서 성공: fn 결과를 반환하고 state=closed 유지', async () => {
    const breaker = makeBreaker();
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await breaker.execute(fn);

    expect(result).toBe('ok');
    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('closed→open 전환: failureThreshold 횟수 연속 실패 후 state=open', async () => {
    const breaker = makeBreaker();
    const err = new Error('boom');
    const fn = vi.fn().mockRejectedValue(err);

    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow('boom');
    }

    expect(breaker.getState()).toBe('open');
    expect(breaker.getFailureCount()).toBe(FAILURE_THRESHOLD);
  });

  it('open 상태에서 즉시 거부: fn 호출 없이 Circuit breaker is open 에러 throw', async () => {
    const breaker = makeBreaker();
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));

    // trip the breaker
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await expect(breaker.execute(failFn)).rejects.toThrow('fail');
    }

    const guardFn = vi.fn();
    await expect(breaker.execute(guardFn)).rejects.toThrow('Circuit breaker is open for test');
    expect(guardFn).not.toHaveBeenCalled();
  });

  it('open→half-open 전환: resetTimeoutMs 경과 후 다음 호출에서 half-open으로 전환', async () => {
    const breaker = makeBreaker();
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));

    // trip the breaker
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await expect(breaker.execute(failFn)).rejects.toThrow('fail');
    }
    expect(breaker.getState()).toBe('open');

    // advance past the reset timeout
    vi.advanceTimersByTime(RESET_TIMEOUT_MS);

    // next call should attempt execution (half-open path) and fail again
    await expect(breaker.execute(failFn)).rejects.toThrow('fail');

    // after the probe fails, it goes back to open — meaning it passed through half-open
    expect(breaker.getState()).toBe('open');
  });

  it('half-open→closed 복구: half-open에서 성공 시 state=closed, failureCount=0', async () => {
    const breaker = makeBreaker();
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));

    // trip the breaker
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await expect(breaker.execute(failFn)).rejects.toThrow('fail');
    }
    expect(breaker.getState()).toBe('open');

    vi.advanceTimersByTime(RESET_TIMEOUT_MS);

    // probe succeeds
    const successFn = vi.fn().mockResolvedValue('recovered');
    const result = await breaker.execute(successFn);

    expect(result).toBe('recovered');
    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(0);
  });

  it('half-open→open 재전환: half-open에서 실패 시 다시 state=open', async () => {
    const breaker = makeBreaker();
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));

    // trip the breaker
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await expect(breaker.execute(failFn)).rejects.toThrow('fail');
    }

    vi.advanceTimersByTime(RESET_TIMEOUT_MS);

    // probe fails → back to open
    await expect(breaker.execute(failFn)).rejects.toThrow('fail');
    expect(breaker.getState()).toBe('open');
  });

  it('threshold 미만 실패: threshold 미만 실패 시 state=closed 유지', async () => {
    const breaker = makeBreaker();
    const failFn = vi.fn().mockRejectedValue(new Error('oops'));

    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      await expect(breaker.execute(failFn)).rejects.toThrow('oops');
    }

    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(FAILURE_THRESHOLD - 1);
  });

  it('reset(): state=closed, failureCount=0으로 초기화', async () => {
    const breaker = makeBreaker();
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await expect(breaker.execute(failFn)).rejects.toThrow('fail');
    }
    expect(breaker.getState()).toBe('open');

    breaker.reset();

    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(0);
  });

  it('getState()/getFailureCount(): 올바른 값 반환', async () => {
    const breaker = makeBreaker();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(0);

    const failFn = vi.fn().mockRejectedValue(new Error('err'));
    await expect(breaker.execute(failFn)).rejects.toThrow('err');

    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(1);
  });
});
