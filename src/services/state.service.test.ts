import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent', REDIS_URL: 'redis://localhost:6379' },
}));

const mockRedis = {
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  zadd: vi.fn(),
  zrevrange: vi.fn(),
  on: vi.fn().mockReturnThis(),
};

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => mockRedis),
}));

import type { PipelineState } from '../types/index.js';
import type { TaskJobData } from './queue.service.js';
import {
  deletePendingConfirmation,
  getPendingConfirmation,
  listRecentPipelines,
  savePendingConfirmation,
  savePipelineState,
} from './state.service.js';

function makeTaskJobData(overrides?: Partial<TaskJobData>): TaskJobData {
  return {
    request: {
      type: 'feature',
      title: 'Test Feature',
      description: 'Test description',
      targetRepo: 'owner/repo',
      priority: 'medium',
      confidence: 0.9,
      missingInfo: null,
    },
    channelId: 'C123',
    threadTs: 'ts123',
    userId: 'U123',
    ...overrides,
  };
}

function makePipelineState(overrides?: Partial<PipelineState>): PipelineState {
  return {
    id: 'pipeline-1',
    threadTs: 'ts123',
    channelId: 'C123',
    userId: 'U123',
    request: {
      type: 'feature',
      title: 'Test Feature',
      description: 'Test description',
      targetRepo: 'owner/repo',
      priority: 'medium',
      confidence: 0.9,
      missingInfo: null,
    },
    status: 'queued',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

describe('state.service — Phase 3 extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('savePipelineState', () => {
    it('should call SET and ZADD when saving pipeline state', async () => {
      const state = makePipelineState();
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.zadd.mockResolvedValue(1);

      await savePipelineState(state);

      expect(mockRedis.set).toHaveBeenCalledWith('pipeline:pipeline-1', JSON.stringify(state));
      expect(mockRedis.zadd).toHaveBeenCalledWith('pipeline:index', state.createdAt, state.id);
    });
  });

  describe('savePendingConfirmation', () => {
    it('should call Redis SET with the pending key and TTL of 1800', async () => {
      const data = makeTaskJobData();
      mockRedis.set.mockResolvedValue('OK');

      await savePendingConfirmation('confirm-1', data);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'pending:confirm-1',
        JSON.stringify(data),
        'EX',
        1800,
      );
    });
  });

  describe('getPendingConfirmation', () => {
    it('should return parsed TaskJobData when the key exists', async () => {
      const data = makeTaskJobData();
      mockRedis.get.mockResolvedValue(JSON.stringify(data));

      const result = await getPendingConfirmation('confirm-1');

      expect(mockRedis.get).toHaveBeenCalledWith('pending:confirm-1');
      expect(result).toEqual(data);
    });

    it('should return null when the key does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await getPendingConfirmation('confirm-missing');

      expect(mockRedis.get).toHaveBeenCalledWith('pending:confirm-missing');
      expect(result).toBeNull();
    });
  });

  describe('deletePendingConfirmation', () => {
    it('should call Redis DEL with the pending key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await deletePendingConfirmation('confirm-1');

      expect(mockRedis.del).toHaveBeenCalledWith('pending:confirm-1');
    });
  });

  describe('listRecentPipelines', () => {
    it('should call ZREVRANGE and fetch each pipeline by id', async () => {
      const state1 = makePipelineState({ id: 'pipeline-1' });
      const state2 = makePipelineState({ id: 'pipeline-2' });

      mockRedis.zrevrange.mockResolvedValue(['pipeline-2', 'pipeline-1']);
      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify(state2))
        .mockResolvedValueOnce(JSON.stringify(state1));

      const result = await listRecentPipelines(10);

      expect(mockRedis.zrevrange).toHaveBeenCalledWith('pipeline:index', 0, 9);
      expect(mockRedis.get).toHaveBeenCalledWith('pipeline:pipeline-2');
      expect(mockRedis.get).toHaveBeenCalledWith('pipeline:pipeline-1');
      expect(result).toEqual([state2, state1]);
    });

    it('should use the default limit of 10', async () => {
      mockRedis.zrevrange.mockResolvedValue([]);

      await listRecentPipelines();

      expect(mockRedis.zrevrange).toHaveBeenCalledWith('pipeline:index', 0, 9);
    });

    it('should filter out null results when a pipeline key has expired', async () => {
      const state1 = makePipelineState({ id: 'pipeline-1' });

      mockRedis.zrevrange.mockResolvedValue(['pipeline-1', 'pipeline-expired']);
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(state1)).mockResolvedValueOnce(null);

      const result = await listRecentPipelines(10);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(state1);
    });

    it('should return an empty array when there are no pipelines', async () => {
      mockRedis.zrevrange.mockResolvedValue([]);

      const result = await listRecentPipelines(10);

      expect(result).toEqual([]);
    });

    it('should respect the limit parameter', async () => {
      mockRedis.zrevrange.mockResolvedValue(['pipeline-1', 'pipeline-2', 'pipeline-3']);
      mockRedis.get.mockResolvedValue(null);

      await listRecentPipelines(3);

      expect(mockRedis.zrevrange).toHaveBeenCalledWith('pipeline:index', 0, 2);
    });
  });
});
