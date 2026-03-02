import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import pino from 'pino';
import { config } from '../config/index.js';

const logger = pino({ name: 'notifications', level: config.LOG_LEVEL });

export async function addReaction(
  app: App,
  channel: string,
  timestamp: string,
  emoji: string,
): Promise<void> {
  try {
    await app.client.reactions.add({
      channel,
      timestamp,
      name: emoji,
    });
  } catch (err) {
    logger.warn({ err, channel, timestamp, emoji }, 'Failed to add reaction');
  }
}

export async function sendThreadMessage(
  app: App,
  channel: string,
  threadTs: string,
  text: string,
  blocks?: KnownBlock[],
): Promise<string | undefined> {
  const result = await app.client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    blocks,
  });
  logger.debug({ channel, threadTs }, 'Sent thread message');
  return result.ts;
}

export async function updateMessage(
  app: App,
  channel: string,
  ts: string,
  text: string,
  blocks?: KnownBlock[],
): Promise<void> {
  await app.client.chat.update({
    channel,
    ts,
    text,
    blocks,
  });
  logger.debug({ channel, ts }, 'Updated message');
}
