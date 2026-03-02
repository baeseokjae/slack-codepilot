import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent' },
}));

vi.mock('./notifications.js', () => ({
  addReaction: vi.fn(),
  sendThreadMessage: vi.fn(),
}));

vi.mock('./conversation.js', () => ({
  handleNewRequest: vi.fn(),
  handleFollowUpReply: vi.fn(),
}));

vi.mock('../services/state.service.js', () => ({
  getThreadContext: vi.fn(),
  getPipelineState: vi.fn(),
  listRecentPipelines: vi.fn(),
}));

vi.mock('./blocks.js', () => ({
  buildStatusBlocks: vi.fn().mockReturnValue([]),
  buildRecentJobsBlocks: vi.fn().mockReturnValue([]),
}));

import {
  getPipelineState,
  getThreadContext,
  listRecentPipelines,
} from '../services/state.service.js';
import { buildRecentJobsBlocks, buildStatusBlocks } from './blocks.js';
import { handleFollowUpReply, handleNewRequest } from './conversation.js';
import { registerEventHandlers } from './events.js';
import { addReaction, sendThreadMessage } from './notifications.js';

const mockAddReaction = vi.mocked(addReaction);
const mockSendThreadMessage = vi.mocked(sendThreadMessage);
const mockHandleNewRequest = vi.mocked(handleNewRequest);
const mockHandleFollowUpReply = vi.mocked(handleFollowUpReply);
const mockGetThreadContext = vi.mocked(getThreadContext);
const mockGetPipelineState = vi.mocked(getPipelineState);
const mockListRecentPipelines = vi.mocked(listRecentPipelines);
const mockBuildStatusBlocks = vi.mocked(buildStatusBlocks);
const mockBuildRecentJobsBlocks = vi.mocked(buildRecentJobsBlocks);

type EventHandler = (args: Record<string, unknown>) => Promise<void>;

describe('events', () => {
  let capturedHandler: EventHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockApp = {
      event: vi.fn((eventName: string, handler: EventHandler) => {
        if (eventName === 'app_mention') {
          capturedHandler = handler;
        }
      }),
    } as unknown as Parameters<typeof registerEventHandlers>[0];

    registerEventHandlers(mockApp);
  });

  it('should register app_mention handler', () => {
    expect(capturedHandler).toBeDefined();
  });

  it('should strip bot mention and handle new request', async () => {
    mockGetThreadContext.mockResolvedValue(null);

    await capturedHandler({
      event: {
        channel: 'C123',
        ts: '1234.5678',
        thread_ts: undefined,
        text: '<@U_BOT> 로그인 버그 수정해줘',
        user: 'U_USER',
      },
      context: { botUserId: 'U_BOT' },
    });

    expect(mockAddReaction).toHaveBeenCalledWith(expect.anything(), 'C123', '1234.5678', 'eyes');
    expect(mockHandleNewRequest).toHaveBeenCalledWith(
      expect.anything(),
      'C123',
      '1234.5678',
      'U_USER',
      '로그인 버그 수정해줘',
    );
  });

  it('should handle follow-up in existing thread', async () => {
    mockGetThreadContext.mockResolvedValue({
      threadTs: 'thread-ts',
      channelId: 'C123',
      userId: 'U_USER',
      originalText: '버그 있어요',
      parsedRequest: null,
      followUpCount: 1,
      messages: [],
      createdAt: Date.now(),
    });

    await capturedHandler({
      event: {
        channel: 'C123',
        ts: '1234.9999',
        thread_ts: 'thread-ts',
        text: '<@U_BOT> 로그인 페이지에서요',
        user: 'U_USER',
      },
      context: { botUserId: 'U_BOT' },
    });

    expect(mockHandleFollowUpReply).toHaveBeenCalledWith(
      expect.anything(),
      'C123',
      'thread-ts',
      '로그인 페이지에서요',
    );
    expect(mockHandleNewRequest).not.toHaveBeenCalled();
  });

  it('should ignore empty message after stripping mention', async () => {
    await capturedHandler({
      event: {
        channel: 'C123',
        ts: '1234.5678',
        thread_ts: undefined,
        text: '<@U_BOT>',
        user: 'U_USER',
      },
      context: { botUserId: 'U_BOT' },
    });

    expect(mockAddReaction).not.toHaveBeenCalled();
    expect(mockHandleNewRequest).not.toHaveBeenCalled();
  });

  describe('status query', () => {
    const mockState = {
      id: 'job-123',
      status: 'in_progress',
      request: {
        title: '테스트 작업',
        type: 'fix',
        priority: 'medium',
        description: '',
        confidence: 0.9,
        targetRepo: null,
      },
      createdAt: Date.now(),
      currentStep: 'generate_code',
    };

    it('should query specific job state when "@CodePilot 상태 job-123" is mentioned', async () => {
      mockGetPipelineState.mockResolvedValue(mockState as never);
      mockBuildStatusBlocks.mockReturnValue([]);

      await capturedHandler({
        event: {
          channel: 'C123',
          ts: '1234.5678',
          thread_ts: undefined,
          text: '<@U_BOT> 상태 job-123',
          user: 'U_USER',
        },
        context: { botUserId: 'U_BOT' },
      });

      expect(mockGetPipelineState).toHaveBeenCalledWith('job-123');
      expect(mockSendThreadMessage).toHaveBeenCalledWith(
        expect.anything(),
        'C123',
        '1234.5678',
        'Job job-123 상태: in_progress',
        [],
      );
      expect(mockHandleNewRequest).not.toHaveBeenCalled();
    });

    it('should send "not found" message when job does not exist', async () => {
      mockGetPipelineState.mockResolvedValue(null);

      await capturedHandler({
        event: {
          channel: 'C123',
          ts: '1234.5678',
          thread_ts: undefined,
          text: '<@U_BOT> 상태 job-123',
          user: 'U_USER',
        },
        context: { botUserId: 'U_BOT' },
      });

      expect(mockGetPipelineState).toHaveBeenCalledWith('job-123');
      expect(mockSendThreadMessage).toHaveBeenCalledWith(
        expect.anything(),
        'C123',
        '1234.5678',
        'Job `job-123`을 찾을 수 없습니다.',
      );
      expect(mockHandleNewRequest).not.toHaveBeenCalled();
    });

    it('should list recent jobs when "@CodePilot 상태" is mentioned without jobId', async () => {
      mockListRecentPipelines.mockResolvedValue([mockState as never]);
      mockBuildRecentJobsBlocks.mockReturnValue([]);

      await capturedHandler({
        event: {
          channel: 'C123',
          ts: '1234.5678',
          thread_ts: undefined,
          text: '<@U_BOT> 상태',
          user: 'U_USER',
        },
        context: { botUserId: 'U_BOT' },
      });

      expect(mockListRecentPipelines).toHaveBeenCalledWith(10);
      expect(mockSendThreadMessage).toHaveBeenCalledWith(
        expect.anything(),
        'C123',
        '1234.5678',
        '최근 작업 목록',
        [],
      );
      expect(mockHandleNewRequest).not.toHaveBeenCalled();
    });

    it('should send "no recent jobs" message when list is empty', async () => {
      mockListRecentPipelines.mockResolvedValue([]);

      await capturedHandler({
        event: {
          channel: 'C123',
          ts: '1234.5678',
          thread_ts: undefined,
          text: '<@U_BOT> 상태',
          user: 'U_USER',
        },
        context: { botUserId: 'U_BOT' },
      });

      expect(mockListRecentPipelines).toHaveBeenCalledWith(10);
      expect(mockSendThreadMessage).toHaveBeenCalledWith(
        expect.anything(),
        'C123',
        '1234.5678',
        '최근 작업이 없습니다.',
      );
    });

    it('should handle English "status job-123" the same as Korean', async () => {
      mockGetPipelineState.mockResolvedValue(mockState as never);
      mockBuildStatusBlocks.mockReturnValue([]);

      await capturedHandler({
        event: {
          channel: 'C123',
          ts: '1234.5678',
          thread_ts: undefined,
          text: '<@U_BOT> status job-123',
          user: 'U_USER',
        },
        context: { botUserId: 'U_BOT' },
      });

      expect(mockGetPipelineState).toHaveBeenCalledWith('job-123');
      expect(mockSendThreadMessage).toHaveBeenCalledWith(
        expect.anything(),
        'C123',
        '1234.5678',
        'Job job-123 상태: in_progress',
        [],
      );
    });

    it('should fall through to normal request handling for non-status mentions', async () => {
      mockGetThreadContext.mockResolvedValue(null);

      await capturedHandler({
        event: {
          channel: 'C123',
          ts: '1234.5678',
          thread_ts: undefined,
          text: '<@U_BOT> 로그인 버그 수정해줘',
          user: 'U_USER',
        },
        context: { botUserId: 'U_BOT' },
      });

      expect(mockGetPipelineState).not.toHaveBeenCalled();
      expect(mockListRecentPipelines).not.toHaveBeenCalled();
      expect(mockHandleNewRequest).toHaveBeenCalledWith(
        expect.anything(),
        'C123',
        '1234.5678',
        'U_USER',
        '로그인 버그 수정해줘',
      );
    });
  });
});
