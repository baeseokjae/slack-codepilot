import { config } from '../../config/index.js';
import { createLogger } from '../../lib/logger.js';
import { createIssue, resolveRepo, searchGitHubUserByEmail } from '../../services/github.service.js';
import { getSlackUserEmail } from '../../services/slack-notifier.service.js';
import type { ParsedRequest } from '../../types/index.js';
import type { PipelineContext } from '../types.js';

const logger = createLogger('step:create-issue');

let userMap: Map<string, string> | null = null;

/** @internal 테스트 전용: 캐시된 userMap 초기화 */
export function _resetUserMapCache(): void {
  userMap = null;
}

function getSlackGitHubUserMap(): Map<string, string> {
  if (userMap) return userMap;
  userMap = new Map();
  const raw = config.SLACK_GITHUB_USER_MAP;
  if (!raw) return userMap;
  // 형식: "U123:github-user,U456:another-user"
  for (const pair of raw.split(',')) {
    const [slackId, githubUser] = pair.trim().split(':');
    if (slackId && githubUser) {
      userMap.set(slackId.trim(), githubUser.trim());
    }
  }
  logger.info({ entries: userMap.size }, 'Loaded SLACK_GITHUB_USER_MAP');
  return userMap;
}

async function resolveAssignee(slackUserId: string): Promise<string[]> {
  // 1) 환경변수 매핑 테이블에서 직접 조회
  const mapped = getSlackGitHubUserMap().get(slackUserId);
  if (mapped) {
    logger.info({ slackUserId, githubUsername: mapped }, 'Resolved GitHub user from SLACK_GITHUB_USER_MAP');
    return [mapped];
  }

  // 2) Slack 이메일 → GitHub 검색 fallback
  const email = await getSlackUserEmail(slackUserId);
  if (!email) {
    logger.warn({ slackUserId }, 'No email found for Slack user — check users:read.email scope');
    return [];
  }

  const githubUsername = await searchGitHubUserByEmail(email);
  if (!githubUsername) {
    logger.warn({ slackUserId, email }, 'No GitHub user found for email — email may be private on GitHub');
    return [];
  }

  return [githubUsername];
}

const TYPE_EMOJI: Record<string, string> = {
  feature: '✨',
  fix: '🐛',
  refactor: '♻️',
  docs: '📝',
  test: '🧪',
};

const TYPE_DISPLAY: Record<string, string> = {
  feature: 'Feature Request',
  fix: 'Bug Fix',
  refactor: 'Refactoring',
  docs: 'Documentation',
  test: 'Test',
};

const PRIORITY_DISPLAY: Record<string, string> = {
  high: '🔴 High',
  medium: '🟡 Medium',
  low: '🟢 Low',
};

export function buildIssueBody(request: ParsedRequest, userId: string): string {
  const emoji = TYPE_EMOJI[request.type] || '📋';
  const typeDisplay = TYPE_DISPLAY[request.type] || request.type;
  const priorityDisplay = PRIORITY_DISPLAY[request.priority] || request.priority;

  const sections: string[] = [];

  // Header
  sections.push(`## ${emoji} ${typeDisplay}: ${request.title}`);

  // Description
  sections.push('### Description');
  sections.push(request.description);

  // Details table
  sections.push('### Details');
  sections.push(
    [
      '| Item | Value |',
      '|------|-------|',
      `| **Type** | ${typeDisplay} |`,
      `| **Priority** | ${priorityDisplay} |`,
      `| **Repository** | \`${request.targetRepo}\` |`,
      `| **Requested by** | <@${userId}> (via Slack) |`,
    ].join('\n'),
  );

  // Footer
  sections.push('---');
  sections.push(
    '_This issue was automatically created by [CodePilot](https://github.com/slack-codepilot) from a Slack conversation._',
  );

  return sections.join('\n\n');
}

export async function createIssueStep(ctx: PipelineContext): Promise<void> {
  if (!ctx.request.targetRepo) {
    throw new Error('targetRepo is required but was null');
  }

  ctx.repoInfo = await resolveRepo(ctx.request.targetRepo);

  const issueTitle = `[CodePilot] ${ctx.request.title}`;

  const typeLabel: Record<string, string> = {
    feature: 'enhancement',
    fix: 'bug',
    refactor: 'refactor',
    docs: 'documentation',
    test: 'test',
  };

  const assignees = await resolveAssignee(ctx.userId);
  if (assignees.length > 0) {
    ctx.githubUsername = assignees[0];
  }

  const issue = await createIssue({
    owner: ctx.repoInfo.owner,
    repo: ctx.repoInfo.repo,
    title: issueTitle,
    body: buildIssueBody(ctx.request, ctx.userId),
    labels: [typeLabel[ctx.request.type] || ctx.request.type, 'codepilot'],
    assignees,
  });

  ctx.issueNumber = issue.number;
  ctx.issueUrl = issue.url;
}
