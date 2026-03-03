import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    AI_PROVIDER: 'openai',
    QWEN_API_KEY: 'test',
    QWEN_API_BASE_URL: 'http://test',
    QWEN_MODEL: 'test',
  },
}));

vi.mock('../services/ai.service.js', () => ({
  chatCompletion: vi.fn(),
}));

import { chatCompletion } from '../services/ai.service.js';
import { parseRequest } from './request-parser.js';

const mockChatCompletion = vi.mocked(chatCompletion);

describe('parseRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse a valid AI response', async () => {
    mockChatCompletion.mockResolvedValue(
      JSON.stringify({
        type: 'fix',
        title: '로그인 버그 수정',
        description: '로그인 시 500 에러',
        targetRepo: null,
        priority: 'high',
        confidence: 0.9,
        missingInfo: null,
      }),
    );

    const result = await parseRequest('로그인 버그 수정해줘');

    expect(result.type).toBe('fix');
    expect(result.title).toBe('로그인 버그 수정');
    expect(result.confidence).toBe(0.9);
    expect(mockChatCompletion).toHaveBeenCalledOnce();
  });

  it('should strip markdown code fences from AI response', async () => {
    mockChatCompletion.mockResolvedValue(
      '```json\n' +
        JSON.stringify({
          type: 'feature',
          title: '새 기능',
          description: '새 기능 추가',
          targetRepo: null,
          priority: 'medium',
          confidence: 0.8,
          missingInfo: null,
        }) +
        '\n```',
    );

    const result = await parseRequest('새 기능 추가해줘');
    expect(result.type).toBe('feature');
  });

  it('should return low-confidence fallback on invalid JSON from AI', async () => {
    mockChatCompletion.mockResolvedValue('this is not json at all');

    const result = await parseRequest('뭔가 해줘');
    expect(result.confidence).toBe(0.3);
    expect(result.missingInfo).toBeTruthy();
  });

  it('should return low-confidence fallback on valid JSON but invalid schema', async () => {
    mockChatCompletion.mockResolvedValue(JSON.stringify({ type: 'unknown', title: 'test' }));

    const result = await parseRequest('뭔가 해줘');
    expect(result.confidence).toBe(0.3);
    expect(result.missingInfo).toBeTruthy();
  });

  it('should include conversation history in messages', async () => {
    mockChatCompletion.mockResolvedValue(
      JSON.stringify({
        type: 'fix',
        title: '로그인 수정',
        description: '비밀번호 입력 시 에러',
        targetRepo: 'auth-service',
        priority: 'high',
        confidence: 0.95,
        missingInfo: null,
      }),
    );

    await parseRequest('비밀번호 입력 시 에러가 나요', [
      { role: 'user', content: '로그인 버그 있어요', timestamp: '1' },
      { role: 'assistant', content: '어떤 에러인지 알려주세요', timestamp: '2' },
    ]);

    const messages = mockChatCompletion.mock.calls[0][0];
    expect(messages).toHaveLength(4); // system + 2 history + 1 text
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toBe('로그인 버그 있어요');
    expect(messages[2].content).toBe('어떤 에러인지 알려주세요');
    expect(messages[3].content).toBe('비밀번호 입력 시 에러가 나요');
  });
});
