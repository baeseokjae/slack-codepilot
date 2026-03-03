import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetJobCounts = vi.fn();
const mockClose = vi.fn();

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    getJobCounts: mockGetJobCounts,
    close: mockClose,
  })),
}));

import type { Redis } from 'ioredis';
import { checkBullMQHealth, checkRedisHealth, deriveOverallStatus } from './health.js';

function makeRedis(overrides?: Partial<Redis>): Redis {
  return {
    ping: vi.fn(),
    ...overrides,
  } as unknown as Redis;
}

describe('checkRedisHealth', () => {
  it('ping 성공 시 status=ok 와 latencyMs를 반환한다', async () => {
    const redis = makeRedis({ ping: vi.fn().mockResolvedValue('PONG') });

    const result = await checkRedisHealth(redis);

    expect(result.status).toBe('ok');
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('ping 실패 시 status=error 와 error 메시지를 반환한다', async () => {
    const redis = makeRedis({ ping: vi.fn().mockRejectedValue(new Error('connection refused')) });

    const result = await checkRedisHealth(redis);

    expect(result.status).toBe('error');
    expect(result.error).toBe('connection refused');
  });
});

describe('checkBullMQHealth', () => {
  beforeEach(() => {
    mockGetJobCounts.mockReset();
    mockClose.mockReset();
    mockClose.mockResolvedValue(undefined);
  });

  it('getJobCounts 성공 시 status=ok 와 counts를 반환한다', async () => {
    mockGetJobCounts.mockResolvedValue({ waiting: 2, active: 1, failed: 0 });

    const redis = makeRedis();
    const result = await checkBullMQHealth('test-queue', redis);

    expect(result.status).toBe('ok');
    expect(result.waiting).toBe(2);
    expect(result.active).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('getJobCounts 실패 시 status=error 와 error 메시지를 반환한다', async () => {
    mockGetJobCounts.mockRejectedValue(new Error('queue unavailable'));

    const redis = makeRedis();
    const result = await checkBullMQHealth('test-queue', redis);

    expect(result.status).toBe('error');
    expect(result.error).toBe('queue unavailable');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});

describe('deriveOverallStatus', () => {
  it('redis와 bullmq 모두 ok이면 healthy를 반환한다', () => {
    const services = {
      redis: { status: 'ok' as const },
      bullmq: { status: 'ok' as const },
    };

    expect(deriveOverallStatus(services)).toBe('healthy');
  });

  it('redis는 ok이고 bullmq가 error이면 degraded를 반환한다', () => {
    const services = {
      redis: { status: 'ok' as const },
      bullmq: { status: 'error' as const, error: 'queue down' },
    };

    expect(deriveOverallStatus(services)).toBe('degraded');
  });

  it('redis가 error이면 unhealthy를 반환한다', () => {
    const services = {
      redis: { status: 'error' as const, error: 'redis down' },
      bullmq: { status: 'ok' as const },
    };

    expect(deriveOverallStatus(services)).toBe('unhealthy');
  });
});
