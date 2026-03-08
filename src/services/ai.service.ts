import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import OpenAI from 'openai';
import { config } from '../config/index.js';
import { CircuitBreaker } from '../lib/circuit-breaker.js';
import { createLogger } from '../lib/logger.js';
import { aiRequestDuration, aiRequestsTotal } from '../lib/metrics.js';
import { RateLimiter } from '../lib/rate-limiter.js';

const logger = createLogger('ai-service');

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      baseURL: config.OPENAI_BASE_URL,
    });
  }
  return openaiClient;
}

async function createVertexClient(): Promise<OpenAI> {
  const { getAccessToken } = await import('./vertex-auth.js');
  const token = await getAccessToken();
  const baseURL = `https://aiplatform.googleapis.com/v1/projects/${config.VERTEX_PROJECT_ID}/locations/${config.VERTEX_LOCATION}/endpoints/openapi`;
  return new OpenAI({ apiKey: token, baseURL });
}

let anthropicVertexClient: AnthropicVertex | null = null;

function getAnthropicVertexClient(): AnthropicVertex {
  if (!anthropicVertexClient) {
    anthropicVertexClient = new AnthropicVertex({
      projectId: config.VERTEX_PROJECT_ID!,
      region: config.VERTEX_LOCATION,
    });
  }
  return anthropicVertexClient;
}

function isClaudeModel(): boolean {
  return config.AI_PROVIDER === 'vertex' && config.VERTEX_MODEL.includes('claude');
}

function getModel(): string {
  return config.AI_PROVIDER === 'vertex' ? config.VERTEX_MODEL : config.OPENAI_MODEL;
}

async function anthropicChatCompletion(
  messages: ChatMessage[],
  options?: ChatCompletionOptions,
): Promise<string> {
  const client = getAnthropicVertexClient();

  let system: string | undefined;
  const apiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content;
    } else {
      apiMessages.push({ role: msg.role, content: msg.content });
    }
  }

  const response = await client.messages.create({
    model: config.VERTEX_MODEL,
    max_tokens: options?.maxTokens ?? 2048,
    temperature: options?.temperature ?? 0.1,
    ...(system ? { system } : {}),
    messages: apiMessages,
  });

  const block = response.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('Empty response from AI');
  }
  if (response.stop_reason === 'max_tokens') {
    logger.warn('AI response was truncated due to max_tokens limit');
  }
  return block.text;
}

const MAX_RATE_LIMIT_RETRIES = 3;

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && 'status' in err && (err as { status: number }).status === 429;
}

function getRetryAfterMs(err: unknown): number | null {
  if (err instanceof Error && 'headers' in err) {
    const headers = (err as { headers: Record<string, string> }).headers;
    const retryAfter = headers?.['retry-after'];
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (!Number.isNaN(seconds)) return seconds * 1000;
    }
  }
  return null;
}

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= MAX_RATE_LIMIT_RETRIES) throw err;
      const retryAfterMs = getRetryAfterMs(err);
      const backoffMs = retryAfterMs ?? Math.min(1000 * 2 ** attempt, 10_000);
      const jitter = Math.random() * 500;
      const waitMs = Math.round(backoffMs + jitter);
      logger.warn({ attempt: attempt + 1, waitMs }, 'Rate limited by AI API, retrying');
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

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
      aiCircuitBreaker.execute(() =>
        withRateLimitRetry(async () => {
          if (isClaudeModel()) {
            return anthropicChatCompletion(messages, options);
          }

          const client =
            config.AI_PROVIDER === 'vertex' ? await createVertexClient() : getOpenAIClient();

          const response = await client.chat.completions.create({
            model: getModel(),
            messages,
            temperature: options?.temperature ?? 0.1,
            max_tokens: options?.maxTokens ?? 2048,
          });

          const choice = response.choices[0];
          const result = choice?.message?.content;
          if (!result) {
            throw new Error('Empty response from AI');
          }
          if (choice.finish_reason === 'length') {
            logger.warn('AI response was truncated due to max_tokens limit');
          }
          return result;
        }),
      ),
    );

    success = true;
    logger.debug({ responseLength: content.length }, 'Received chat completion response');
    return content;
  } finally {
    aiRequestDuration.observe((Date.now() - startTime) / 1000);
    aiRequestsTotal.inc({ status: success ? 'success' : 'error' });
  }
}
