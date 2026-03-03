import OpenAI from 'openai';
import { config } from '../config/index.js';
import { CircuitBreaker } from '../lib/circuit-breaker.js';
import { createLogger } from '../lib/logger.js';
import { aiRequestDuration, aiRequestsTotal } from '../lib/metrics.js';
import { RateLimiter } from '../lib/rate-limiter.js';

const logger = createLogger('ai-service');

const client = new OpenAI({
  apiKey: config.QWEN_API_KEY,
  baseURL: config.QWEN_API_BASE_URL,
});

const aiCircuitBreaker = new CircuitBreaker({
  name: 'ai',
  failureThreshold: 3,
  resetTimeoutMs: 30000,
});

const aiRateLimiter = new RateLimiter({ concurrency: 1, minTimeMs: 200 });

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  maxTokens?: number;
  temperature?: number;
}

export async function chatCompletion(
  messages: ChatMessage[],
  options?: ChatCompletionOptions,
): Promise<string> {
  logger.debug({ messageCount: messages.length }, 'Sending chat completion request');

  const startTime = Date.now();
  let success = false;
  try {
    const content = await aiRateLimiter.execute(() =>
      aiCircuitBreaker.execute(async () => {
        const response = await client.chat.completions.create({
          model: config.QWEN_MODEL,
          messages,
          temperature: options?.temperature ?? 0.1,
          max_tokens: options?.maxTokens ?? 2048,
        });

        const result = response.choices[0]?.message?.content;
        if (!result) {
          throw new Error('Empty response from AI');
        }
        return result;
      }),
    );

    success = true;
    logger.debug({ responseLength: content.length }, 'Received chat completion response');
    return content;
  } finally {
    aiRequestDuration.observe((Date.now() - startTime) / 1000);
    aiRequestsTotal.inc({ status: success ? 'success' : 'error' });
  }
}
