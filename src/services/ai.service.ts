import OpenAI from 'openai';
import pino from 'pino';
import { config } from '../config/index.js';

const logger = pino({ name: 'ai-service', level: config.LOG_LEVEL });

const client = new OpenAI({
  apiKey: config.QWEN_API_KEY,
  baseURL: config.QWEN_API_BASE_URL,
});

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

  const response = await client.chat.completions.create({
    model: config.QWEN_MODEL,
    messages,
    temperature: options?.temperature ?? 0.1,
    max_tokens: options?.maxTokens ?? 2048,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from AI');
  }

  logger.debug({ responseLength: content.length }, 'Received chat completion response');
  return content;
}
