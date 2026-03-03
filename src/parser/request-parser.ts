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
  }

  messages.push({ role: 'user', content: text });

  const raw = await chatCompletion(messages);
  logger.debug({ raw }, 'Raw AI response');

  const cleaned = raw
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    logger.error({ raw: cleaned }, 'AI returned invalid JSON');
    throw new Error(`AI returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  const parsed = parsedRequestSchema.safeParse(json);
  if (!parsed.success) {
    logger.error({ errors: parsed.error.flatten() }, 'Failed to validate AI response');
    throw new Error(`Invalid AI response schema: ${parsed.error.message}`);
  }

  logger.info(
    { type: parsed.data.type, confidence: parsed.data.confidence, title: parsed.data.title },
    'Request parsed',
  );

  return parsed.data;
}
