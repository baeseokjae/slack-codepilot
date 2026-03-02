import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent' },
}));

vi.mock('../services/queue.service.js', () => ({
  enqueueTask: vi.fn(),
  cancelJob: vi.fn(),
}));

vi.mock('../services/state.service.js', () => ({
  getPendingConfirmation: vi.fn(),
  deletePendingConfirmation: vi.fn(),
  getPipelineState: vi.fn(),
  savePipelineState: vi.fn(),
}));

vi.mock('./blocks.js', () => ({
  buildPipelineCancelledBlocks: vi.fn().mockReturnValue([]),
}));

import type { App } from '@slack/bolt';
import type { TaskJobData } from '../services/queue.service.js';
import { cancelJob, enqueueTask } from '../services/queue.service.js';
import {
  deletePendingConfirmation,
  getPendingConfirmation,
  getPipelineState,
  savePipelineState,
} from '../services/state.service.js';
import type { PipelineState } from '../types/index.js';
import { registerActionHandlers } from './actions.js';
import { buildPipelineCancelledBlocks } from './blocks.js';

const mockEnqueueTask = vi.mocked(enqueueTask);
const mockCancelJob = vi.mocked(cancelJob);
const mockGetPendingConfirmation = vi.mocked(getPendingConfirmation);
const mockDeletePendingConfirmation = vi.mocked(deletePendingConfirmation);
const mockGetPipelineState = vi.mocked(getPipelineState);
const mockSavePipelineState = vi.mocked(savePipelineState);
const mockBuildPipelineCancelledBlocks = vi.mocked(buildPipelineCancelledBlocks);

type ActionHandler = (args: Record<string, unknown>) => Promise<void>;

function makePendingData(): TaskJobData {
  return {
    request: {
      type: 'feature',
      title: '새 기능 추가',
      description: '설명',
      targetRepo: 'owner/repo',
      priority: 'medium',
      confidence: 0.9,
      missingInfo: null,
    },
    channelId: 'C123',
    threadTs: 'ts123',
    userId: 'U123',
  };
}

function makePipelineState(overrides?: Partial<PipelineState>): PipelineState {
  return {
    id: 'job-abc',
    threadTs: 'ts123',
    channelId: 'C123',
    userId: 'U123',
    request: {
      type: 'feature',
      title: '새 기능 추가',
      description: '설명',
      targetRepo: 'owner/repo',
      priority: 'medium',
      confidence: 0.9,
      missingInfo: null,
    },
    status: 'in_progress',
    createdAt: 1700000000000,
    updatedAt: 1700000010000,
    ...overrides,
  };
}

describe('registerActionHandlers', () => {
  let actionHandlers: Map<string, ActionHandler>;
  let mockApp: App;

  beforeEach(() => {
    vi.clearAllMocks();
    actionHandlers = new Map<string, ActionHandler>();
    mockApp = {
      action: vi.fn((pattern: string | RegExp, handler: ActionHandler) => {
        actionHandlers.set(pattern.toString(), handler);
      }),
    } as unknown as App;

    registerActionHandlers(mockApp);
  });

  it('should register all three action handlers', () => {
    expect(mockApp.action).toHaveBeenCalledTimes(3);
    expect(actionHandlers.has('/^approve_task:/')).toBe(true);
    expect(actionHandlers.has('/^reject_task:/')).toBe(true);
    expect(actionHandlers.has('/^cancel_task:/')).toBe(true);
  });

  describe('approve handler', () => {
    function getApproveHandler(): ActionHandler {
      const handler = actionHandlers.get('/^approve_task:/');
      if (!handler) throw new Error('approve handler not registered');
      return handler;
    }

    function makeApproveArgs(overrides?: Record<string, unknown>) {
      const mockUpdate = vi.fn().mockResolvedValue({});
      return {
        action: { action_id: 'approve_task:pending-123' },
        ack: vi.fn().mockResolvedValue(undefined),
        body: {
          user: { id: 'U_APPROVER' },
          channel: { id: 'C123', name: 'general' },
          message: { type: 'message', ts: 'msg-ts-1' },
        },
        client: { chat: { update: mockUpdate } },
        ...overrides,
      };
    }

    it('should call ack, deletePendingConfirmation, enqueueTask, and chat.update on approve', async () => {
      const pending = makePendingData();
      mockGetPendingConfirmation.mockResolvedValue(pending);
      mockEnqueueTask.mockResolvedValue('job-new-1');

      const args = makeApproveArgs();
      const handler = getApproveHandler();
      await handler(args as unknown as Record<string, unknown>);

      expect(args.ack).toHaveBeenCalledOnce();
      expect(mockGetPendingConfirmation).toHaveBeenCalledWith('pending-123');
      expect(mockDeletePendingConfirmation).toHaveBeenCalledWith('pending-123');
      expect(mockEnqueueTask).toHaveBeenCalledWith(pending);
      expect(args.client.chat.update).toHaveBeenCalledOnce();

      const updateCall = args.client.chat.update.mock.calls[0][0];
      expect(updateCall.channel).toBe('C123');
      expect(updateCall.ts).toBe('msg-ts-1');
      expect(updateCall.text).toContain('job-new-1');
    });

    it('should include approver mention in blocks on successful approve', async () => {
      const pending = makePendingData();
      mockGetPendingConfirmation.mockResolvedValue(pending);
      mockEnqueueTask.mockResolvedValue('job-xyz');

      const args = makeApproveArgs();
      const handler = getApproveHandler();
      await handler(args as unknown as Record<string, unknown>);

      const updateCall = args.client.chat.update.mock.calls[0][0];
      const blocksText = JSON.stringify(updateCall.blocks);
      expect(blocksText).toContain('<@U_APPROVER>');
      expect(blocksText).toContain('job-xyz');
      expect(blocksText).toContain('새 기능 추가');
    });

    it('should update message with expiry notice when pending is null (already processed)', async () => {
      mockGetPendingConfirmation.mockResolvedValue(null);

      const args = makeApproveArgs();
      const handler = getApproveHandler();
      await handler(args as unknown as Record<string, unknown>);

      expect(mockDeletePendingConfirmation).not.toHaveBeenCalled();
      expect(mockEnqueueTask).not.toHaveBeenCalled();
      expect(args.client.chat.update).toHaveBeenCalledOnce();

      const updateCall = args.client.chat.update.mock.calls[0][0];
      expect(updateCall.text).toContain('이미 처리되었거나 만료된 요청입니다');
      expect(updateCall.blocks).toEqual([]);
    });

    it('should return early when channel is missing', async () => {
      mockGetPendingConfirmation.mockResolvedValue(makePendingData());

      const args = {
        action: { action_id: 'approve_task:pending-123' },
        ack: vi.fn().mockResolvedValue(undefined),
        body: {
          user: { id: 'U_APPROVER' },
          channel: undefined,
          message: { type: 'message', ts: 'msg-ts-1' },
        },
        client: { chat: { update: vi.fn() } },
      };
      const handler = getApproveHandler();
      await handler(args as unknown as Record<string, unknown>);

      expect(args.client.chat.update).not.toHaveBeenCalled();
    });

    it('should return early when message is missing', async () => {
      mockGetPendingConfirmation.mockResolvedValue(makePendingData());

      const args = {
        action: { action_id: 'approve_task:pending-123' },
        ack: vi.fn().mockResolvedValue(undefined),
        body: {
          user: { id: 'U_APPROVER' },
          channel: { id: 'C123', name: 'general' },
          message: undefined,
        },
        client: { chat: { update: vi.fn() } },
      };
      const handler = getApproveHandler();
      await handler(args as unknown as Record<string, unknown>);

      expect(args.client.chat.update).not.toHaveBeenCalled();
    });
  });

  describe('reject handler', () => {
    function getRejectHandler(): ActionHandler {
      const handler = actionHandlers.get('/^reject_task:/');
      if (!handler) throw new Error('reject handler not registered');
      return handler;
    }

    function makeRejectArgs() {
      const mockUpdate = vi.fn().mockResolvedValue({});
      return {
        action: { action_id: 'reject_task:pending-456' },
        ack: vi.fn().mockResolvedValue(undefined),
        body: {
          user: { id: 'U_REJECTER' },
          channel: { id: 'C456', name: 'general' },
          message: { type: 'message', ts: 'msg-ts-2' },
        },
        client: { chat: { update: mockUpdate } },
      };
    }

    it('should call ack, deletePendingConfirmation, and chat.update with rejection message', async () => {
      const args = makeRejectArgs();
      const handler = getRejectHandler();
      await handler(args as unknown as Record<string, unknown>);

      expect(args.ack).toHaveBeenCalledOnce();
      expect(mockDeletePendingConfirmation).toHaveBeenCalledWith('pending-456');
      expect(args.client.chat.update).toHaveBeenCalledOnce();

      const updateCall = args.client.chat.update.mock.calls[0][0];
      expect(updateCall.channel).toBe('C456');
      expect(updateCall.ts).toBe('msg-ts-2');
      expect(updateCall.text).toContain('거부');
    });

    it('should include rejecter mention in blocks', async () => {
      const args = makeRejectArgs();
      const handler = getRejectHandler();
      await handler(args as unknown as Record<string, unknown>);

      const updateCall = args.client.chat.update.mock.calls[0][0];
      const blocksText = JSON.stringify(updateCall.blocks);
      expect(blocksText).toContain('<@U_REJECTER>');
      expect(blocksText).toContain('거부');
    });

    it('should return early when channel is missing', async () => {
      const args = {
        action: { action_id: 'reject_task:pending-456' },
        ack: vi.fn().mockResolvedValue(undefined),
        body: {
          user: { id: 'U_REJECTER' },
          channel: undefined,
          message: { type: 'message', ts: 'msg-ts-2' },
        },
        client: { chat: { update: vi.fn() } },
      };
      const handler = getRejectHandler();
      await handler(args as unknown as Record<string, unknown>);

      expect(args.client.chat.update).not.toHaveBeenCalled();
    });
  });

  describe('cancel handler', () => {
    function getCancelHandler(): ActionHandler {
      const handler = actionHandlers.get('/^cancel_task:/');
      if (!handler) throw new Error('cancel handler not registered');
      return handler;
    }

    function makeCancelArgs(jobId = 'job-abc') {
      const mockUpdate = vi.fn().mockResolvedValue({});
      return {
        action: { action_id: `cancel_task:${jobId}` },
        ack: vi.fn().mockResolvedValue(undefined),
        body: {
          user: { id: 'U_CANCELLER' },
          channel: { id: 'C789', name: 'general' },
          message: { type: 'message', ts: 'msg-ts-3' },
        },
        client: { chat: { update: mockUpdate } },
      };
    }

    it('should cancel in_progress job: savePipelineState + cancelJob + chat.update', async () => {
      const state = makePipelineState({ status: 'in_progress' });
      mockGetPipelineState.mockResolvedValue(state);
      mockCancelJob.mockResolvedValue(true);
      mockBuildPipelineCancelledBlocks.mockReturnValue([]);

      const args = makeCancelArgs('job-abc');
      const handler = getCancelHandler();
      await handler(args as unknown as Record<string, unknown>);

      expect(args.ack).toHaveBeenCalledOnce();
      expect(mockGetPipelineState).toHaveBeenCalledWith('job-abc');
      expect(mockSavePipelineState).toHaveBeenCalledOnce();

      const savedState = mockSavePipelineState.mock.calls[0][0];
      expect(savedState.status).toBe('cancelled');
      expect(savedState.cancelledBy).toBe('U_CANCELLER');
      expect(savedState.cancelledAt).toBeTypeOf('number');

      expect(mockCancelJob).toHaveBeenCalledWith('job-abc', expect.stringContaining('U_CANCELLER'));
      expect(args.client.chat.update).toHaveBeenCalledOnce();

      const updateCall = args.client.chat.update.mock.calls[0][0];
      expect(updateCall.channel).toBe('C789');
      expect(updateCall.ts).toBe('msg-ts-3');
      expect(updateCall.text).toContain('취소');
    });

    it('should do nothing when job is already completed', async () => {
      const state = makePipelineState({ status: 'completed' });
      mockGetPipelineState.mockResolvedValue(state);

      const args = makeCancelArgs('job-done');
      const handler = getCancelHandler();
      await handler(args as unknown as Record<string, unknown>);

      expect(mockSavePipelineState).not.toHaveBeenCalled();
      expect(mockCancelJob).not.toHaveBeenCalled();
      expect(args.client.chat.update).not.toHaveBeenCalled();
    });

    it('should do nothing when job is already cancelled', async () => {
      const state = makePipelineState({ status: 'cancelled' });
      mockGetPipelineState.mockResolvedValue(state);

      const args = makeCancelArgs('job-cancelled');
      const handler = getCancelHandler();
      await handler(args as unknown as Record<string, unknown>);

      expect(mockSavePipelineState).not.toHaveBeenCalled();
      expect(mockCancelJob).not.toHaveBeenCalled();
      expect(args.client.chat.update).not.toHaveBeenCalled();
    });

    it('should do nothing when pipeline state is null', async () => {
      mockGetPipelineState.mockResolvedValue(null);

      const args = makeCancelArgs('job-missing');
      const handler = getCancelHandler();
      await handler(args as unknown as Record<string, unknown>);

      expect(mockSavePipelineState).not.toHaveBeenCalled();
      expect(mockCancelJob).not.toHaveBeenCalled();
      expect(args.client.chat.update).not.toHaveBeenCalled();
    });

    it('should return early when channel is missing', async () => {
      const state = makePipelineState({ status: 'in_progress' });
      mockGetPipelineState.mockResolvedValue(state);

      const args = {
        action: { action_id: 'cancel_task:job-abc' },
        ack: vi.fn().mockResolvedValue(undefined),
        body: {
          user: { id: 'U_CANCELLER' },
          channel: undefined,
          message: { type: 'message', ts: 'msg-ts-3' },
        },
        client: { chat: { update: vi.fn() } },
      };
      const handler = getCancelHandler();
      await handler(args as unknown as Record<string, unknown>);

      expect(mockSavePipelineState).not.toHaveBeenCalled();
      expect(args.client.chat.update).not.toHaveBeenCalled();
    });

    it('should call buildPipelineCancelledBlocks with updated state', async () => {
      const state = makePipelineState({ status: 'in_progress' });
      mockGetPipelineState.mockResolvedValue(state);
      mockCancelJob.mockResolvedValue(true);
      mockBuildPipelineCancelledBlocks.mockReturnValue([
        { type: 'section', text: { type: 'mrkdwn', text: '취소됨' } },
      ]);

      const args = makeCancelArgs('job-abc');
      const handler = getCancelHandler();
      await handler(args as unknown as Record<string, unknown>);

      expect(mockBuildPipelineCancelledBlocks).toHaveBeenCalledOnce();
      const passedState = mockBuildPipelineCancelledBlocks.mock.calls[0][0];
      expect(passedState.status).toBe('cancelled');
      expect(passedState.cancelledBy).toBe('U_CANCELLER');
    });
  });
});
