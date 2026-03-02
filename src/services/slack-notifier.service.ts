import type { KnownBlock } from '@slack/types';
import { WebClient } from '@slack/web-api';
import pino from 'pino';
import { config } from '../config/index.js';

const logger = pino({ name: 'slack-notifier', level: config.LOG_LEVEL });

const client = new WebClient(config.SLACK_BOT_TOKEN);

export async function notify(
  channelId: string,
  threadTs: string,
  text: string,
  blocks?: KnownBlock[],
): Promise<string | undefined> {
  try {
    const result = await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text,
      blocks,
    });
    logger.debug({ channelId, threadTs }, 'Notification sent');
    return result.ts;
  } catch (err) {
    // Non-fatal: log but don't throw
    logger.error({ err, channelId, threadTs }, 'Failed to send Slack notification');
    return undefined;
  }
}

export async function updateNotification(
  channelId: string,
  ts: string,
  text: string,
  blocks?: KnownBlock[],
): Promise<void> {
  try {
    await client.chat.update({
      channel: channelId,
      ts,
      text,
      blocks,
    });
    logger.debug({ channelId, ts }, 'Notification updated');
  } catch (err) {
    logger.error({ err, channelId, ts }, 'Failed to update Slack notification');
  }
}
