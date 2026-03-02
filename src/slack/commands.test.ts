import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent' },
}));

vi.mock('../services/state.service.js', () => ({
  getPipelineState: vi.fn(),
  listRecentPipelines: vi.fn(),
}));

vi.mock('./blocks.js', () => ({
  buildStatusBlocks: vi
    .fn()
    .mockReturnValue([{ type: 'section', text: { type: 'mrkdwn', text: 'status' } }]),
  buildRecentJobsBlocks: vi
    .fn()
    .mockReturnValue([{ type: 'section', text: { type: 'mrkdwn', text: 'list' } }]),
}));

import type { App } from '@slack/bolt';
import { getPipelineState, listRecentPipelines } from '../services/state.service.js';
import type { PipelineState } from '../types/index.js';
import { registerCommandHandlers } from './commands.js';

const mockGetPipelineState = vi.mocked(getPipelineState);
const mockListRecentPipelines = vi.mocked(listRecentPipelines);

function makePipelineState(overrides?: Partial<PipelineState>): PipelineState {
  return {
    id: 'job-123',
    threadTs: 'ts-abc',
    channelId: 'C123',
    userId: 'U123',
    request: {
      type: 'feature',
      title: '테스트 기능',
      description: '테스트 설명',
      targetRepo: 'owner/repo',
      priority: 'medium',
      confidence: 0.9,
      missingInfo: null,
    },
    status: 'completed',
    createdAt: 1700000000000,
    updatedAt: 1700000010000,
    ...overrides,
  };
}

describe('registerCommandHandlers', () => {
  let commandHandler: (args: {
    command: { text: string };
    ack: () => Promise<void>;
    respond: (response: { text: string; blocks?: unknown[] }) => Promise<void>;
  }) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();

    const mockApp = {
      command: vi.fn((_name: string, handler: typeof commandHandler) => {
        commandHandler = handler;
      }),
    } as unknown as App;

    registerCommandHandlers(mockApp);
  });

  it('should register /codepilot command handler', () => {
    expect(commandHandler).toBeDefined();
  });

  describe('status subcommand', () => {
    it('should respond with status blocks when job is found', async () => {
      const state = makePipelineState({ id: 'job-123', status: 'in_progress' });
      mockGetPipelineState.mockResolvedValue(state);

      const mockAck = vi.fn().mockResolvedValue(undefined);
      const mockRespond = vi.fn().mockResolvedValue(undefined);

      await commandHandler({
        command: { text: 'status job-123' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalledOnce();
      expect(mockGetPipelineState).toHaveBeenCalledWith('job-123');
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('job-123'),
          blocks: expect.arrayContaining([expect.objectContaining({ type: 'section' })]),
        }),
      );
    });

    it('should respond with not-found message when job does not exist', async () => {
      mockGetPipelineState.mockResolvedValue(null);

      const mockAck = vi.fn().mockResolvedValue(undefined);
      const mockRespond = vi.fn().mockResolvedValue(undefined);

      await commandHandler({
        command: { text: 'status job-999' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalledOnce();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('찾을 수 없습니다'),
        }),
      );
    });

    it('should respond with usage hint when jobId is missing', async () => {
      const mockAck = vi.fn().mockResolvedValue(undefined);
      const mockRespond = vi.fn().mockResolvedValue(undefined);

      await commandHandler({
        command: { text: 'status' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalledOnce();
      expect(mockGetPipelineState).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('사용법'),
        }),
      );
    });
  });

  describe('list subcommand', () => {
    it('should respond with recent jobs blocks when jobs exist', async () => {
      const states = [
        makePipelineState({ id: 'job-1', status: 'completed' }),
        makePipelineState({ id: 'job-2', status: 'in_progress' }),
      ];
      mockListRecentPipelines.mockResolvedValue(states);

      const mockAck = vi.fn().mockResolvedValue(undefined);
      const mockRespond = vi.fn().mockResolvedValue(undefined);

      await commandHandler({
        command: { text: 'list' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalledOnce();
      expect(mockListRecentPipelines).toHaveBeenCalledWith(10);
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('최근 작업 목록'),
          blocks: expect.arrayContaining([expect.objectContaining({ type: 'section' })]),
        }),
      );
    });

    it('should respond with empty message when no jobs exist', async () => {
      mockListRecentPipelines.mockResolvedValue([]);

      const mockAck = vi.fn().mockResolvedValue(undefined);
      const mockRespond = vi.fn().mockResolvedValue(undefined);

      await commandHandler({
        command: { text: 'list' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalledOnce();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('최근 작업이 없습니다'),
        }),
      );
    });
  });

  describe('help subcommand', () => {
    it('should respond with help text when help is requested', async () => {
      const mockAck = vi.fn().mockResolvedValue(undefined);
      const mockRespond = vi.fn().mockResolvedValue(undefined);

      await commandHandler({
        command: { text: 'help' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalledOnce();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('CodePilot 명령어'),
        }),
      );
    });

    it('should respond with help text for unknown subcommand', async () => {
      const mockAck = vi.fn().mockResolvedValue(undefined);
      const mockRespond = vi.fn().mockResolvedValue(undefined);

      await commandHandler({
        command: { text: 'unknown-subcommand' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalledOnce();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('CodePilot 명령어'),
        }),
      );
    });

    it('should respond with help text when command text is empty', async () => {
      const mockAck = vi.fn().mockResolvedValue(undefined);
      const mockRespond = vi.fn().mockResolvedValue(undefined);

      await commandHandler({
        command: { text: '' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(mockAck).toHaveBeenCalledOnce();
      expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('CodePilot 명령어'),
        }),
      );
    });
  });

  describe('ack behavior', () => {
    it('should always call ack first before any async operation', async () => {
      const callOrder: string[] = [];

      mockGetPipelineState.mockImplementation(async () => {
        callOrder.push('getPipelineState');
        return null;
      });

      const mockAck = vi.fn().mockImplementation(async () => {
        callOrder.push('ack');
      });
      const mockRespond = vi.fn().mockResolvedValue(undefined);

      await commandHandler({
        command: { text: 'status job-123' },
        ack: mockAck,
        respond: mockRespond,
      });

      expect(callOrder[0]).toBe('ack');
    });
  });
});
