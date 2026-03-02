import pino from 'pino';
import { config } from '../config/index.js';
import { FOLLOW_UP_SYSTEM_PROMPT } from '../prompts/request-parsing.js';
import { type ChatMessage, chatCompletion } from '../services/ai.service.js';
import type { ThreadContext } from '../types/index.js';

const logger = pino({ name: 'follow-up', level: config.LOG_LEVEL });

export async function generateFollowUp(ctx: ThreadContext): Promise<string> {
  const messages: ChatMessage[] = [{ role: 'system', content: FOLLOW_UP_SYSTEM_PROMPT }];

  messages.push({
    role: 'user',
    content: `원래 요청: "${ctx.originalText}"

파싱 결과:
${ctx.parsedRequest ? JSON.stringify(ctx.parsedRequest, null, 2) : '파싱 실패'}

부족한 정보: ${ctx.parsedRequest?.missingInfo?.join(', ') ?? '없음'}

대화 기록:
${ctx.messages.map((m) => `${m.role}: ${m.content}`).join('\n')}

위 정보를 바탕으로, 부족한 정보를 얻기 위한 간결한 후속 질문을 한국어로 생성해주세요.`,
  });

  const question = await chatCompletion(messages);
  logger.debug({ question }, 'Generated follow-up question');
  return question.trim();
}
