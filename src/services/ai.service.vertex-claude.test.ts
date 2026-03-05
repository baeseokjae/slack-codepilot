import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMessagesCreate = vi.hoisted(() => vi.fn());

vi.mock('../lib/metrics.js', () => ({
  aiRequestDuration: { observe: vi.fn() },
  aiRequestsTotal: { inc: vi.fn() },
}));

vi.mock('../config/index.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    AI_PROVIDER: 'vertex',
    VERTEX_PROJECT_ID: 'rockb-489106',
    VERTEX_LOCATION: 'asia-northeast3',
    VERTEX_MODEL: 'claude-opus-4-6',
  },
}));

vi.mock('@anthropic-ai/vertex-sdk', () => ({
  AnthropicVertex: vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
  })),
}));

vi.mock('./vertex-auth.js', () => ({
  getAccessToken: vi.fn(),
}));

vi.mock('../lib/circuit-breaker.js', () => ({
  CircuitBreaker: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  })),
}));

vi.mock('../lib/rate-limiter.js', () => ({
  RateLimiter: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  })),
}));

import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import OpenAI from 'openai';
import { chatCompletion } from './ai.service.js';

describe('ai.service (vertex claude mode)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should use AnthropicVertex client with correct projectId and region', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello from Claude' }],
    });

    const result = await chatCompletion([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ]);

    expect(result).toBe('Hello from Claude');
    expect(AnthropicVertex).toHaveBeenCalledWith({
      projectId: 'rockb-489106',
      region: 'asia-northeast3',
    });
    expect(vi.mocked(OpenAI)).not.toHaveBeenCalled();
  });

  it('should extract system message into separate parameter', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'response' }],
    });

    await chatCompletion([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User message' },
      { role: 'assistant', content: 'Assistant reply' },
      { role: 'user', content: 'Follow up' },
    ]);

    expect(mockMessagesCreate).toHaveBeenCalledWith({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      temperature: 0.1,
      system: 'System prompt',
      messages: [
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Assistant reply' },
        { role: 'user', content: 'Follow up' },
      ],
    });
  });

  it('should handle messages without system prompt', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'response' }],
    });

    await chatCompletion([{ role: 'user', content: 'test' }]);

    const call = mockMessagesCreate.mock.calls[0][0];
    expect(call).not.toHaveProperty('system');
    expect(call.messages).toEqual([{ role: 'user', content: 'test' }]);
  });

  it('should throw on empty response', async () => {
    mockMessagesCreate.mockResolvedValue({ content: [] });

    await expect(
      chatCompletion([{ role: 'user', content: 'test' }]),
    ).rejects.toThrow('Empty response from AI');
  });

  it('should pass custom maxTokens and temperature', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    await chatCompletion(
      [{ role: 'user', content: 'test' }],
      { maxTokens: 8192, temperature: 0.7 },
    );

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 8192, temperature: 0.7 }),
    );
  });
});
