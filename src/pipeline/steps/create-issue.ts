import { createLogger } from '../../lib/logger.js';
import { createIssue, findExistingIssue, resolveRepo } from '../../services/github.service.js';
import { notify } from '../../services/slack-notifier.service.js';
import type { PipelineContext } from '../types.js';

const logger = createLogger('step:create-issue');

export async function createIssueStep(ctx: PipelineContext): Promise<void> {
  if (!ctx.request.targetRepo) {
    throw new Error('targetRepo is required but was null');
  }

  ctx.repoInfo = await resolveRepo(ctx.request.targetRepo);

  const issueTitle = `[CodePilot] ${ctx.request.title}`;

  const existing = await findExistingIssue({
    owner: ctx.repoInfo.owner,
    repo: ctx.repoInfo.repo,
    title: issueTitle,
  });

  if (existing) {
    logger.info({ issueNumber: existing.number }, 'Using existing issue');
    ctx.issueNumber = existing.number;
    ctx.issueUrl = existing.url;
  } else {
    const typeLabel: Record<string, string> = {
      feature: 'enhancement',
      fix: 'bug',
      refactor: 'refactor',
      docs: 'documentation',
      test: 'test',
    };

    const issue = await createIssue({
      owner: ctx.repoInfo.owner,
      repo: ctx.repoInfo.repo,
      title: issueTitle,
      body: `## ${ctx.request.type}: ${ctx.request.title}\n\n${ctx.request.description}\n\n---\n_Created by CodePilot from Slack request_`,
      labels: [typeLabel[ctx.request.type] || ctx.request.type, 'codepilot'],
    });

    ctx.issueNumber = issue.number;
    ctx.issueUrl = issue.url;
  }

  await notify(
    ctx.channelId,
    ctx.threadTs,
    `:ticket: Issue #${ctx.issueNumber} 생성 완료\n${ctx.issueUrl}`,
  );
}
