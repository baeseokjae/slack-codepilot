import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import pino from 'pino';
import { config } from '../config/index.js';
import { cancelJob, enqueueTask } from '../services/queue.service.js';
import {
  deletePendingConfirmation,
  getPendingConfirmation,
  getPipelineState,
  savePipelineState,
} from '../services/state.service.js';
import { buildPipelineCancelledBlocks } from './blocks.js';

const logger = pino({ name: 'actions', level: config.LOG_LEVEL });

export function registerActionHandlers(app: App): void {
  // 승인 버튼 클릭
  app.action<BlockAction<ButtonAction>>(/^approve_task:/, async ({ action, ack, body, client }) => {
    await ack();

    const channelId = body.channel?.id;
    const messageTs = body.message?.ts;
    if (!channelId || !messageTs) return;

    const pendingId = action.action_id.split(':')[1];
    const pending = await getPendingConfirmation(pendingId);

    if (!pending) {
      // 이미 처리되었거나 만료됨
      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: '이미 처리되었거나 만료된 요청입니다.',
        blocks: [],
      });
      return;
    }

    await deletePendingConfirmation(pendingId);
    const jobId = await enqueueTask(pending);

    // 메시지 업데이트: 버튼 제거, 승인 상태 표시
    const blocks: KnownBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:white_check_mark: *작업이 승인되었습니다*\n> ${pending.request.title}\nJob ID: \`${jobId}\``,
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `승인자: <@${body.user.id}>` }],
      },
    ];

    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: `작업이 승인되었습니다. (Job: ${jobId})`,
      blocks,
    });

    logger.info({ pendingId, jobId, user: body.user.id }, 'Task approved');
  });

  // 거부 버튼 클릭
  app.action<BlockAction<ButtonAction>>(/^reject_task:/, async ({ action, ack, body, client }) => {
    await ack();

    const channelId = body.channel?.id;
    const messageTs = body.message?.ts;
    if (!channelId || !messageTs) return;

    const pendingId = action.action_id.split(':')[1];
    await deletePendingConfirmation(pendingId);

    const blocks: KnownBlock[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: ':x: *작업이 거부되었습니다*' },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `거부자: <@${body.user.id}>` }],
      },
    ];

    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: '작업이 거부되었습니다.',
      blocks,
    });

    logger.info({ pendingId, user: body.user.id }, 'Task rejected');
  });

  // 취소 버튼 클릭
  app.action<BlockAction<ButtonAction>>(/^cancel_task:/, async ({ action, ack, body, client }) => {
    await ack();

    const channelId = body.channel?.id;
    const messageTs = body.message?.ts;
    if (!channelId || !messageTs) return;

    const jobId = action.action_id.split(':')[1];
    const state = await getPipelineState(jobId);

    if (!state || state.status === 'completed' || state.status === 'cancelled') {
      return;
    }

    state.status = 'cancelled';
    state.cancelledBy = body.user.id;
    state.cancelledAt = Date.now();
    state.updatedAt = Date.now();
    await savePipelineState(state);

    await cancelJob(jobId, `Cancelled by <@${body.user.id}>`);

    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: '작업이 취소되었습니다.',
      blocks: buildPipelineCancelledBlocks(state),
    });

    logger.info({ jobId, user: body.user.id }, 'Task cancelled');
  });
}
