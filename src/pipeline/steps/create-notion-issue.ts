import pino from 'pino';
import { config } from '../../config/index.js';
import { createLogger } from '../../lib/logger.js';
import { notionService } from '../../services/notion.service.js';
import type { PipelineContext } from '../types.js';

const logger = createLogger('create-notion-issue-step');

export async function createNotionIssueStep(ctx: PipelineContext): Promise<void> {
  const { title, description, type, priority } = ctx.request;

  if (!config.NOTION_ISSUE_DATABASE_ID) {
    logger.warn('NOTION_ISSUE_DATABASE_ID is not configured, skipping Notion issue creation.');
    return;
  }

  logger.info({ title, type, priority }, 'Creating Notion issue');

  const properties: Record<string, any> = {
    Name: {
      title: [{ text: { content: title } }],
    },
    Description: {
      rich_text: [{ text: { content: description } }],
    },
    Type: {
      select: { name: type },
    },
    Priority: {
      select: { name: priority },
    },
    'Slack Thread': {
      url: `https://slack.com/archives/${ctx.channelId}/p${ctx.threadTs.replace('.', '')}`,
    },
    Status: {
      select: { name: 'To Do' },
    },
  };

  try {
    const page = await notionService.createPage(config.NOTION_ISSUE_DATABASE_ID, properties);
    ctx.notionPageUrl = page.url;
    logger.info({ notionPageUrl: page.url }, 'Notion issue created');
  } catch (error) {
    logger.error({ error }, 'Failed to create Notion issue');
    throw error;
  }
}
