import { randomUUID } from 'node:crypto';
import type { App } from '@slack/bolt';
import { createLogger } from '../lib/logger.js';
import { generateFollowUp } from '../parser/follow-up.js';
import { parseRequest } from '../parser/request-parser.js';
import {
  getThreadContext,
  savePendingConfirmation,
  saveThreadContext,
} from '../services/state.service.js';
import type { ThreadContext } from '../types/index.js';
import { buildConfirmationBlocks } from './blocks.js';
import { sendThreadMessage } from './notifications.js';

const logger = createLogger('conversation');
const MAX_FOLLOW_UPS = 3;
const CONFIDENCE_THRESHOLD = 0.7;

export async function handleNewRequest(
  app: App,
  channelId: string,
  threadTs: string,
  userId: string,
  text: string,
): Promise<void> {
  const parsed = await parseRequest(text);

  const ctx: ThreadContext = {
    threadTs,
    channelId,
    userId,
    originalText: text,
    parsedRequest: parsed,
    followUpCount: 0,
    messages: [{ role: 'user', content: text, timestamp: threadTs }],
    createdAt: Date.now(),
  };

  if (parsed.confidence >= CONFIDENCE_THRESHOLD && !parsed.missingInfo?.length) {
    await saveThreadContext(ctx);
    const pendingId = randomUUID();
    await savePendingConfirmation(pendingId, { request: parsed, conversationHistory: ctx.messages, channelId, threadTs, userId });
    const blocks = buildConfirmationBlocks(parsed, pendingId);
    await sendThreadMessage(app, channelId, threadTs, `새 작업 요청: ${parsed.title}`, blocks);
  } else {
    await saveThreadContext(ctx);
    await askFollowUp(app, ctx);
  }
}

export async function handleFollowUpReply(
  app: App,
  channelId: string,
  threadTs: string,
  text: string,
): Promise<void> {
  const ctx = await getThreadContext(channelId, threadTs);
  if (!ctx) {
    logger.warn({ channelId, threadTs }, 'No thread context found for follow-up');
    return;
  }

  ctx.messages.push({ role: 'user', content: text, timestamp: String(Date.now()) });

  const reParsed = await parseRequest(ctx.originalText, ctx.messages);

  ctx.parsedRequest = reParsed;

  if (reParsed.confidence >= CONFIDENCE_THRESHOLD && !reParsed.missingInfo?.length) {
    await saveThreadContext(ctx);
    const pendingId = randomUUID();
    await savePendingConfirmation(pendingId, {
      request: reParsed,
      conversationHistory: ctx.messages,
      channelId,
      threadTs,
      userId: ctx.userId,
    });
    const blocks = buildConfirmationBlocks(reParsed, pendingId);
    await sendThreadMessage(app, channelId, threadTs, `새 작업 요청: ${reParsed.title}`, blocks);
  } else if (ctx.followUpCount < MAX_FOLLOW_UPS) {
    await saveThreadContext(ctx);
    await askFollowUp(app, ctx);
  } else {
    // MAX_FOLLOW_UPS 도달 — 현재까지 수집한 정보로 강제 진행
    const forceRequest = { ...reParsed, confidence: 1.0, missingInfo: null };
    ctx.parsedRequest = forceRequest;
    await saveThreadContext(ctx);
    const pendingId = randomUUID();
    await savePendingConfirmation(pendingId, {
      request: forceRequest,
      conversationHistory: ctx.messages,
      channelId,
      threadTs,
      userId: ctx.userId,
    });
    const blocks = buildConfirmationBlocks(forceRequest, pendingId);
    await sendThreadMessage(app, channelId, threadTs, `새 작업 요청: ${forceRequest.title}`, blocks);
  }
}

async function askFollowUp(app: App, ctx: ThreadContext): Promise<void> {
  const question = await generateFollowUp(ctx);
  ctx.followUpCount++;
  ctx.messages.push({ role: 'assistant', content: question, timestamp: String(Date.now()) });
  await saveThreadContext(ctx);
  await sendThreadMessage(app, ctx.channelId, ctx.threadTs, question);
}
