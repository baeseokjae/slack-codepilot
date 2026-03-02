import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent', REDIS_URL: 'redis://localhost:6379' },
}));

const mockJob = vi.hoisted(() => ({
  id: 'job-1',
  token: 'token-1' as string | undefined,
  getState: vi.fn(),
  remove: vi.fn(),
  moveToFailed: vi.fn(),
}));

const mockQueue = vi.hoisted(() => ({
  add: vi.fn(),
  getJob: vi.fn(),
  close: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn(() => mockQueue),
}));

import { cancelJob, getJob } from './queue.service.js';

describe('parseRedisUrl logic', () => {
  function parseRedisUrl(url: string): { host: string; port: number } {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port, 10) || 6379,
    };
  }

  it('should parse standard redis URL', () => {
    const result = parseRedisUrl('redis://localhost:6379');
    expect(result).toEqual({ host: 'localhost', port: 6379 });
  });

  it('should parse redis URL with custom host and port', () => {
    const result = parseRedisUrl('redis://redis-server:6380');
    expect(result).toEqual({ host: 'redis-server', port: 6380 });
  });

  it('should default port to 6379 when not specified', () => {
    const result = parseRedisUrl('redis://myhost');
    expect(result).toEqual({ host: 'myhost', port: 6379 });
  });
});

describe('getJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the job when it exists', async () => {
    mockQueue.getJob.mockResolvedValue(mockJob);

    const result = await getJob('job-1');

    expect(mockQueue.getJob).toHaveBeenCalledWith('job-1');
    expect(result).toBe(mockJob);
  });

  it('should return undefined when job does not exist', async () => {
    mockQueue.getJob.mockResolvedValue(null);

    const result = await getJob('nonexistent');

    expect(mockQueue.getJob).toHaveBeenCalledWith('nonexistent');
    expect(result).toBeUndefined();
  });
});

describe('cancelJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJob.token = 'token-1';
  });

  it('should return false when job does not exist', async () => {
    mockQueue.getJob.mockResolvedValue(null);

    const result = await cancelJob('missing-job', 'user cancelled');

    expect(result).toBe(false);
    expect(mockQueue.getJob).toHaveBeenCalledWith('missing-job');
  });

  it('should return false when job state is completed', async () => {
    mockJob.getState.mockResolvedValue('completed');
    mockQueue.getJob.mockResolvedValue(mockJob);

    const result = await cancelJob('job-1', 'user cancelled');

    expect(result).toBe(false);
    expect(mockJob.remove).not.toHaveBeenCalled();
    expect(mockJob.moveToFailed).not.toHaveBeenCalled();
  });

  it('should return false when job state is failed', async () => {
    mockJob.getState.mockResolvedValue('failed');
    mockQueue.getJob.mockResolvedValue(mockJob);

    const result = await cancelJob('job-1', 'user cancelled');

    expect(result).toBe(false);
    expect(mockJob.remove).not.toHaveBeenCalled();
    expect(mockJob.moveToFailed).not.toHaveBeenCalled();
  });

  it('should call remove() and return true when job state is waiting', async () => {
    mockJob.getState.mockResolvedValue('waiting');
    mockJob.remove.mockResolvedValue(undefined);
    mockQueue.getJob.mockResolvedValue(mockJob);

    const result = await cancelJob('job-1', 'user cancelled');

    expect(result).toBe(true);
    expect(mockJob.remove).toHaveBeenCalledTimes(1);
    expect(mockJob.moveToFailed).not.toHaveBeenCalled();
  });

  it('should call remove() and return true when job state is delayed', async () => {
    mockJob.getState.mockResolvedValue('delayed');
    mockJob.remove.mockResolvedValue(undefined);
    mockQueue.getJob.mockResolvedValue(mockJob);

    const result = await cancelJob('job-1', 'user cancelled');

    expect(result).toBe(true);
    expect(mockJob.remove).toHaveBeenCalledTimes(1);
    expect(mockJob.moveToFailed).not.toHaveBeenCalled();
  });

  it('should call moveToFailed() and return true when job state is active', async () => {
    mockJob.getState.mockResolvedValue('active');
    mockJob.moveToFailed.mockResolvedValue(undefined);
    mockQueue.getJob.mockResolvedValue(mockJob);

    const result = await cancelJob('job-1', 'user cancelled');

    expect(result).toBe(true);
    expect(mockJob.moveToFailed).toHaveBeenCalledWith(new Error('user cancelled'), 'token-1', true);
    expect(mockJob.remove).not.toHaveBeenCalled();
  });

  it('should use token fallback "0" when job.token is undefined', async () => {
    mockJob.token = undefined;
    mockJob.getState.mockResolvedValue('active');
    mockJob.moveToFailed.mockResolvedValue(undefined);
    mockQueue.getJob.mockResolvedValue(mockJob);

    const result = await cancelJob('job-1', 'cancelled');

    expect(result).toBe(true);
    expect(mockJob.moveToFailed).toHaveBeenCalledWith(new Error('cancelled'), '0', true);
  });
});
