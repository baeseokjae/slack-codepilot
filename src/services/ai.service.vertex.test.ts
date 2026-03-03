import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());
const mockGetAccessToken = vi.hoisted(() => vi.fn());

vi.mock('../lib/metrics.js', () => ({
  aiRequestDuration: { observe: vi.fn() },
  aiRequestsTotal: { inc: vi.fn() },
}));

vi.mock('../config/index.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    AI_PROVIDER: 'vertex',
    VERTEX_PROJECT_ID: 'my-gcp-project',
    VERTEX_LOCATION: 'us-central1',
    VERTEX_MODEL: 'google/gemini-2.5-flash',
    QWEN_MODEL: 'qwen3-coder',
  },
}));

vi.mock('./vertex-auth.js', () => ({
  getAccessToken: mockGetAccessToken,
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

import OpenAI from 'openai';
import { chatCompletion } from './ai.service.js';

describe('ai.service (vertex mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct OpenAI client with correct Vertex baseURL and access token', async () => {
    mockGetAccessToken.mockResolvedValue('fake-gcp-token');
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Gemini says hello' } }],
    });

    const result = await chatCompletion([{ role: 'user', content: 'Hello' }]);

    expect(result).toBe('Gemini says hello');
    expect(mockGetAccessToken).toHaveBeenCalledTimes(1);

    const OpenAIMock = vi.mocked(OpenAI);
    expect(OpenAIMock).toHaveBeenCalledWith({
      apiKey: 'fake-gcp-token',
      baseURL:
        'https://us-central1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/us-central1/endpoints/openapi',
    });
  });

  it('should use VERTEX_MODEL from config', async () => {
    mockGetAccessToken.mockResolvedValue('fake-gcp-token');
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'response' } }],
    });

    await chatCompletion([{ role: 'user', content: 'test' }]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'google/gemini-2.5-flash',
      }),
    );
  });

  it('should propagate errors from getAccessToken', async () => {
    mockGetAccessToken.mockRejectedValue(new Error('Token fetch failed'));

    await expect(chatCompletion([{ role: 'user', content: 'test' }])).rejects.toThrow(
      'Token fetch failed',
    );
  });
});
