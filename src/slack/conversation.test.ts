import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    AI_PROVIDER: 'openai',
    REDIS_URL: 'redis://localhost:6379',
    OPENAI_API_KEY: 'test',
    OPENAI_BASE_URL: 'http://test',
    OPENAI_MODEL: 'test',
    THREAD_TTL_SECONDS: 3600,
    PENDING_TTL_SECONDS: 1800,
  },
}));

vi.mock('../parser/request-parser.js', () => ({
  parseRequest: vi.fn(),
}));

vi.mock('../parser/follow-up.js', () => ({
  generateFollowUp: vi.fn(),
}));

vi.mock('./notifications.js', () => ({
  sendThreadMessage: vi.fn(),
}));

vi.mock('../services/state.service.js', () => ({
  saveThreadContext: vi.fn(),
  getThreadContext: vi.fn(),
  savePendingConfirmation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./blocks.js', () => ({
  buildConfirmationBlocks: vi
    .fn()
    .mockReturnValue([{ type: 'section', text: { type: 'mrkdwn', text: 'mock block' } }]),
}));

import { generateFollowUp } from '../parser/follow-up.js';
import { parseRequest } from '../parser/request-parser.js';
import {
  getThreadContext,
  savePendingConfirmation,
  saveThreadContext,
} from '../services/state.service.js';
import { buildConfirmationBlocks } from './blocks.js';
import { handleFollowUpReply, handleNewRequest } from './conversation.js';
import { sendThreadMessage } from './notifications.js';

const mockParseRequest = vi.mocked(parseRequest);
const mockGenerateFollowUp = vi.mocked(generateFollowUp);
const mockSendThreadMessage = vi.mocked(sendThreadMessage);
const mockSaveThreadContext = vi.mocked(saveThreadContext);
const mockGetThreadContext = vi.mocked(getThreadContext);
const mockSavePendingConfirmation = vi.mocked(savePendingConfirmation);
const mockBuildConfirmationBlocks = vi.mocked(buildConfirmationBlocks);

function createMockApp() {
  return { client: { chat: { postMessage: vi.fn() } } } as unknown as Parameters<
    typeof handleNewRequest
  >[0];
}

describe('conversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleNewRequest', () => {
    it('should save pending confirmation and send blocks when confidence is high', async () => {
      const app = createMockApp();
      mockParseRequest.mockResolvedValue({
        type: 'fix',
        title: '버그 수정',
        description: '로그인 에러',
        targetRepo: null,
        priority: 'high',
        confidence: 0.9,
        missingInfo: null,
      });

      await handleNewRequest(app, 'C123', 'ts123', 'U123', '로그인 버그 수정');

      expect(mockSaveThreadContext).toHaveBeenCalledOnce();
      expect(mockSavePendingConfirmation).toHaveBeenCalledOnce();
      // Verify conversationHistory is passed
      const pendingArgs = mockSavePendingConfirmation.mock.calls[0];
      expect(pendingArgs[1].conversationHistory).toEqual([
        { role: 'user', content: '로그인 버그 수정', timestamp: 'ts123' },
      ]);
      expect(mockBuildConfirmationBlocks).toHaveBeenCalledOnce();
      expect(mockSendThreadMessage).toHaveBeenCalledOnce();
      // Should send with blocks (5th argument)
      const callArgs = mockSendThreadMessage.mock.calls[0];
      expect(callArgs[3]).toContain('새 작업 요청');
      expect(callArgs[4]).toBeDefined();
      expect(Array.isArray(callArgs[4])).toBe(true);
    });

    it('should ask follow-up when confidence is low', async () => {
      const app = createMockApp();
      mockParseRequest.mockResolvedValue({
        type: 'fix',
        title: '버그 수정',
        description: '에러 발생',
        targetRepo: null,
        priority: 'medium',
        confidence: 0.4,
        missingInfo: ['어떤 에러인지', '재현 방법'],
      });
      mockGenerateFollowUp.mockResolvedValue('어떤 에러가 발생하나요?');

      await handleNewRequest(app, 'C123', 'ts123', 'U123', '버그 있어요');

      expect(mockSavePendingConfirmation).not.toHaveBeenCalled();
      expect(mockGenerateFollowUp).toHaveBeenCalledOnce();
      expect(mockSendThreadMessage).toHaveBeenCalledWith(
        app,
        'C123',
        'ts123',
        '어떤 에러가 발생하나요?',
      );
    });

    it('should ask follow-up when missingInfo is present even with high confidence', async () => {
      const app = createMockApp();
      mockParseRequest.mockResolvedValue({
        type: 'feature',
        title: '기능 추가',
        description: '뭔가 추가',
        targetRepo: null,
        priority: 'medium',
        confidence: 0.8,
        missingInfo: ['어떤 기능인지 구체적으로'],
      });
      mockGenerateFollowUp.mockResolvedValue('구체적으로 어떤 기능을 원하시나요?');

      await handleNewRequest(app, 'C123', 'ts123', 'U123', '기능 추가해줘');

      expect(mockSavePendingConfirmation).not.toHaveBeenCalled();
      expect(mockGenerateFollowUp).toHaveBeenCalledOnce();
    });
  });

  describe('handleFollowUpReply', () => {
    it('should save pending confirmation and send blocks after successful re-parse', async () => {
      const app = createMockApp();
      mockGetThreadContext.mockResolvedValue({
        threadTs: 'ts123',
        channelId: 'C123',
        userId: 'U123',
        originalText: '버그 있어요',
        parsedRequest: null,
        followUpCount: 1,
        messages: [
          { role: 'user', content: '버그 있어요', timestamp: 'ts123' },
          { role: 'assistant', content: '어떤 버그인가요?', timestamp: '2' },
        ],
        createdAt: Date.now(),
      });
      mockParseRequest.mockResolvedValue({
        type: 'fix',
        title: '로그인 에러 수정',
        description: '비밀번호 입력 시 500 에러',
        targetRepo: 'auth-app',
        priority: 'high',
        confidence: 0.95,
        missingInfo: null,
      });

      await handleFollowUpReply(app, 'C123', 'ts123', '비밀번호 입력하면 500 에러나요');

      expect(mockSavePendingConfirmation).toHaveBeenCalledOnce();
      // Verify conversationHistory includes original + follow-up messages
      const pendingArgs = mockSavePendingConfirmation.mock.calls[0];
      expect(pendingArgs[1].conversationHistory).toHaveLength(3);
      expect(pendingArgs[1].conversationHistory![0]).toEqual({ role: 'user', content: '버그 있어요', timestamp: 'ts123' });
      expect(pendingArgs[1].conversationHistory![2].content).toBe('비밀번호 입력하면 500 에러나요');
      expect(mockBuildConfirmationBlocks).toHaveBeenCalledOnce();
      const callArgs = mockSendThreadMessage.mock.calls[0];
      expect(callArgs[3]).toContain('새 작업 요청');
      expect(callArgs[4]).toBeDefined();
      expect(Array.isArray(callArgs[4])).toBe(true);
    });

    it('should force proceed with confirmation when MAX_FOLLOW_UPS is reached', async () => {
      const app = createMockApp();
      mockGetThreadContext.mockResolvedValue({
        threadTs: 'ts123',
        channelId: 'C123',
        userId: 'U123',
        originalText: '뭔가 해줘',
        parsedRequest: null,
        followUpCount: 3,
        messages: [],
        createdAt: Date.now(),
      });
      mockParseRequest.mockResolvedValue({
        type: 'fix',
        title: '뭔가',
        description: '뭔가',
        targetRepo: null,
        priority: 'medium',
        confidence: 0.3,
        missingInfo: ['전부 다'],
      });

      await handleFollowUpReply(app, 'C123', 'ts123', '모르겠어요');

      expect(mockGenerateFollowUp).not.toHaveBeenCalled();
      // Should force proceed with confirmation instead of giving up
      expect(mockSavePendingConfirmation).toHaveBeenCalledOnce();
      const pendingArgs = mockSavePendingConfirmation.mock.calls[0];
      expect(pendingArgs[1].request.confidence).toBe(1.0);
      expect(pendingArgs[1].request.missingInfo).toBeNull();
      expect(mockBuildConfirmationBlocks).toHaveBeenCalledOnce();
      const callArgs = mockSendThreadMessage.mock.calls[0];
      expect(callArgs[3]).toContain('새 작업 요청');
      expect(callArgs[4]).toBeDefined();
    });

    it('should silently return when no thread context exists', async () => {
      const app = createMockApp();
      mockGetThreadContext.mockResolvedValue(null);

      await handleFollowUpReply(app, 'C123', 'ts123', 'hello');

      expect(mockParseRequest).not.toHaveBeenCalled();
      expect(mockSendThreadMessage).not.toHaveBeenCalled();
    });
  });
});
