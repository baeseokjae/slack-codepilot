import { createLogger } from '../../lib/logger.js';
import {
  buildRepoUrl,
  createNotionIssue,
  isNotionConfigured,
  resolveNotionUserId,
  updateNotionIssueWithGitHub,
} from '../../services/notion.service.js';
import { getSlackUserEmail } from '../../services/slack-notifier.service.js';
import { buildSlackPermalink } from './create-issue.js';
import type { PipelineContext } from '../types.js';

const logger = createLogger('step:create-notion-issue');

export async function createNotionIssueStep(ctx: PipelineContext): Promise<void> {
  if (!isNotionConfigured()) {
    logger.info('Notion not configured, skipping step');
    return;
  }

  if (!ctx.request.targetRepo) {
    throw new Error('targetRepo is required but was null');
  }

  const slackPermalink =
    ctx.channelId && ctx.threadTs
      ? buildSlackPermalink(ctx.channelId, ctx.threadTs)
      : undefined;

  let notionUserId: string | null = null;
  try {
    const email = await getSlackUserEmail(ctx.userId);
    if (email) {
      notionUserId = await resolveNotionUserId(email);
    }
  } catch (err) {
    logger.warn({ err, userId: ctx.userId }, 'Failed to resolve Notion user');
  }

  const result = await createNotionIssue({
    title: `[CodePilot] ${ctx.request.title}`,
    type: ctx.request.type,
    priority: ctx.request.priority,
    description: ctx.request.description,
    repositoryUrl: buildRepoUrl(ctx.request.targetRepo),
    notionUserId,
    slackPermalink,
    confidence: ctx.request.confidence,
    acceptanceCriteria: ctx.request.acceptanceCriteria,
    conversationHistory: ctx.conversationHistory,
  });

  ctx.notionPageId = result.pageId;
  ctx.notionPageUrl = result.pageUrl;

  logger.info({ notionPageId: result.pageId, notionPageUrl: result.pageUrl }, 'Notion issue created');
}

export async function linkGitHubToNotion(ctx: PipelineContext): Promise<void> {
  if (!ctx.notionPageId || !ctx.issueUrl) return;

  try {
    await updateNotionIssueWithGitHub(ctx.notionPageId, ctx.issueUrl);
  } catch (err) {
    logger.warn({ err, notionPageId: ctx.notionPageId }, 'Failed to update Notion with GitHub link');
  }
}
