import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('../lib/metrics.js', () => ({
  aiRequestDuration: { observe: vi.fn() },
  aiRequestsTotal: { inc: vi.fn() },
}));

vi.mock('../config/index.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    QWEN_API_KEY: 'test-key',
    QWEN_API_BASE_URL: 'https://test.example.com',
    QWEN_MODEL: 'test-model',
  },
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
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

import { chatCompletion } from './ai.service.js';

describe('ai.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return content from AI response', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Hello from AI' } }],
    });

    const result = await chatCompletion([{ role: 'user', content: 'Hello' }]);

    expect(result).toBe('Hello from AI');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.1,
      max_tokens: 2048,
    });
  });

  it('should use provided options for temperature and maxTokens', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'response' } }],
    });

    await chatCompletion([{ role: 'user', content: 'test' }], {
      temperature: 0.7,
      maxTokens: 512,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.7,
        max_tokens: 512,
      }),
    );
  });

  it('should throw when AI returns empty content', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    await expect(chatCompletion([{ role: 'user', content: 'test' }])).rejects.toThrow(
      'Empty response from AI',
    );
  });

  it('should throw when AI returns no choices', async () => {
    mockCreate.mockResolvedValue({
      choices: [],
    });

    await expect(chatCompletion([{ role: 'user', content: 'test' }])).rejects.toThrow(
      'Empty response from AI',
    );
  });

  it('should propagate errors thrown by the OpenAI client', async () => {
    mockCreate.mockRejectedValue(new Error('Network error'));

    await expect(chatCompletion([{ role: 'user', content: 'test' }])).rejects.toThrow(
      'Network error',
    );
  });

  it('should pass multiple messages to the API', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'answered' } }],
    });

    const messages = [
      { role: 'system' as const, content: 'You are a helpful assistant.' },
      { role: 'user' as const, content: 'What is 2+2?' },
      { role: 'assistant' as const, content: '4' },
      { role: 'user' as const, content: 'Are you sure?' },
    ];

    await chatCompletion(messages);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ messages }));
  });
});
