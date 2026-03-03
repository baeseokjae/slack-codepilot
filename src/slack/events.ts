import type { App } from '@slack/bolt';
import { createLogger } from '../lib/logger.js';
import { slackEventsTotal } from '../lib/metrics.js';
import {
  getPipelineState,
  getThreadContext,
  listRecentPipelines,
} from '../services/state.service.js';
import { buildRecentJobsBlocks, buildStatusBlocks } from './blocks.js';
import { handleFollowUpReply, handleNewRequest } from './conversation.js';
import { addReaction, sendThreadMessage } from './notifications.js';

const logger = createLogger('events');

export function registerEventHandlers(app: App): void {
  app.event('app_mention', async ({ event, context }) => {
    slackEventsTotal.inc({ type: 'mention' });
    const { channel, ts, thread_ts, text, user } = event;
    const threadTs = thread_ts || ts;
    const botUserId = context.botUserId;

    logger.info({ channel, threadTs, user }, 'Received app_mention event');

    // Strip bot mention from text
    const cleanText = text.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim();

    if (!cleanText) {
      logger.debug('Empty message after stripping mention, ignoring');
      return;
    }

    // Add eyes reaction to acknowledge
    await addReaction(app, channel, ts, 'eyes');

    try {
      // 상태 조회 멘션 감지
      const statusMatch = cleanText.match(/^(?:상태|status)\s*(.*)?$/i);
      if (statusMatch) {
        const jobId = statusMatch[1]?.trim();
        if (jobId) {
          // 특정 job 상태 조회
          const state = await getPipelineState(jobId);
          if (state) {
            await sendThreadMessage(
              app,
              channel,
              threadTs,
              `Job ${jobId} 상태: ${state.status}`,
              buildStatusBlocks(state),
            );
          } else {
            await sendThreadMessage(app, channel, threadTs, `Job \`${jobId}\`을 찾을 수 없습니다.`);
          }
        } else {
          // 최근 작업 목록
          const states = await listRecentPipelines(10);
          if (states.length === 0) {
            await sendThreadMessage(app, channel, threadTs, '최근 작업이 없습니다.');
          } else {
            await sendThreadMessage(
              app,
              channel,
              threadTs,
              '최근 작업 목록',
              buildRecentJobsBlocks(states),
            );
          }
        }
        return;
      }

      // Check if this is a follow-up in an existing thread
      const existingContext = await getThreadContext(channel, threadTs);

      if (existingContext) {
        logger.info({ channel, threadTs }, 'Handling follow-up reply');
        await handleFollowUpReply(app, channel, threadTs, cleanText);
      } else {
        logger.info({ channel, threadTs }, 'Handling new request');
        await handleNewRequest(app, channel, threadTs, user ?? 'unknown', cleanText);
      }
    } catch (err) {
      logger.error({ err, channel, threadTs }, 'Error handling app_mention');
      await app.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요. :warning:',
      });
    }
  });

  logger.info('Event handlers registered');
}
