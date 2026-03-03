import type { App } from '@slack/bolt';
import { createLogger } from '../lib/logger.js';
import { slackEventsTotal } from '../lib/metrics.js';
import { getPipelineState, listRecentPipelines } from '../services/state.service.js';
import { buildRecentJobsBlocks, buildStatusBlocks } from './blocks.js';

const logger = createLogger('commands');

export function registerCommandHandlers(app: App): void {
  app.command('/codepilot', async ({ command, ack, respond }) => {
    await ack();
    slackEventsTotal.inc({ type: 'command' });

    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase() || 'help';

    logger.info({ subcommand, args: command.text }, 'Slash command received');

    switch (subcommand) {
      case 'status': {
        const jobId = args[1];
        if (!jobId) {
          await respond({ text: '사용법: `/codepilot status [job-id]`' });
          return;
        }
        const state = await getPipelineState(jobId);
        if (!state) {
          await respond({ text: `Job \`${jobId}\`을 찾을 수 없습니다.` });
          return;
        }
        await respond({
          text: `Job ${jobId} 상태: ${state.status}`,
          blocks: buildStatusBlocks(state),
        });
        break;
      }

      case 'list': {
        const states = await listRecentPipelines(10);
        if (states.length === 0) {
          await respond({ text: '최근 작업이 없습니다.' });
          return;
        }
        await respond({
          text: '최근 작업 목록',
          blocks: buildRecentJobsBlocks(states),
        });
        break;
      }

      default: {
        await respond({
          text:
            '*CodePilot 명령어*\n\n' +
            '`/codepilot status [job-id]` — 작업 상태 조회\n' +
            '`/codepilot list` — 최근 작업 목록\n' +
            '`/codepilot help` — 도움말',
        });
        break;
      }
    }
  });
}
