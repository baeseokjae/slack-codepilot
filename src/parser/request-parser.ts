import { createLogger } from '../lib/logger.js';
import { REQUEST_PARSING_SYSTEM_PROMPT } from '../prompts/request-parsing.js';
import { type ChatMessage, chatCompletion } from '../services/ai.service.js';
import type { ConversationMessage, ParsedRequest } from '../types/index.js';
import { parsedRequestSchema } from './schemas.js';

const logger = createLogger('request-parser');

export async function parseRequest(
  text: string,
  conversationHistory?: ConversationMessage[],
): Promise<ParsedRequest> {
  const messages: ChatMessage[] = [{ role: 'system', content: REQUEST_PARSING_SYSTEM_PROMPT }];

  if (conversationHistory?.length) {
    for (const msg of conversationHistory) {
      messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
    }
  } else {
    messages.push({ role: 'user', content: text });
  }

  const raw = await chatCompletion(messages);
  logger.info({ raw: raw.slice(0, 500) }, 'Raw AI response');

  // Strip markdown fences, <think> blocks, and any non-JSON text
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  // Extract the first JSON object from the response
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.error({ raw: cleaned }, 'AI returned no JSON object');
    return {
      type: 'feature',
      title: text.slice(0, 50),
      description: text,
      targetRepo: null,
      priority: 'medium' as const,
      confidence: 0.3,
      missingInfo: ['요청을 이해하지 못했습니다. 좀 더 구체적으로 설명해주세요.'],
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(jsonMatch[0]);
  } catch {
    logger.error({ raw: jsonMatch[0] }, 'AI returned invalid JSON');
    return {
      type: 'feature',
      title: text.slice(0, 50),
      description: text,
      targetRepo: null,
      priority: 'medium' as const,
      confidence: 0.3,
      missingInfo: ['요청을 이해하지 못했습니다. 좀 더 구체적으로 설명해주세요.'],
    };
  }

  const parsed = parsedRequestSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn({ errors: parsed.error.flatten() }, 'AI response schema mismatch, using fallback');
    return {
      type: 'feature',
      title: text.slice(0, 50),
      description: text,
      targetRepo: null,
      priority: 'medium' as const,
      confidence: 0.3,
      missingInfo: ['요청을 정확히 분석하지 못했습니다. 좀 더 자세히 설명해주시겠어요?'],
    };
  }

  logger.info(
    { type: parsed.data.type, confidence: parsed.data.confidence, title: parsed.data.title },
    'Request parsed',
  );

  return parsed.data;
}
