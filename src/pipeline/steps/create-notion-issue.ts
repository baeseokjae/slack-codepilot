import { Client } from '@notionhq/client';
import { config } from '../../config/index.js';
import { createLogger } from '../../lib/logger.js';
import type { PipelineContext } from '../types.js';

const logger = createLogger('create-notion-issue');

export async function createNotionIssueStep(ctx: PipelineContext): Promise<void> {
  if (!config.NOTION_API_KEY || !config.NOTION_ISSUE_DATABASE_ID) {
    logger.warn('Notion integration not configured, skipping Notion issue creation.');
    return;
  }

  const notion = new Client({ auth: config.NOTION_API_KEY });
  const { request } = ctx;

  logger.info({ title: request.title }, 'Creating Notion issue');

  const properties: Record<string, any> = {
    Title: {
      title: [{ type: 'text', text: { content: request.title } }],
    },
    Description: {
      rich_text: [{ type: 'text', text: { content: request.description } }],
    },
    Type: {
      select: { name: request.type },
    },
    Priority: {
      select: { name: request.priority },
    },
  };

  if (request.targetRepo) {
    properties['Target Repo'] = {
      rich_text: [{ type: 'text', text: { content: request.targetRepo } }],
    };
  }

  if (request.acceptanceCriteria?.length) {
    properties['Acceptance Criteria'] = {
      rich_text: [{ type: 'text', text: { content: request.acceptanceCriteria.join('\n- ') } }],
    };
  }

  const response = await notion.pages.create({
    parent: {
      database_id: config.NOTION_ISSUE_DATABASE_ID,
    },
    properties,
  });

  ctx.notionPageUrl = response.url;
  logger.info({ notionPageUrl: response.url }, 'Notion issue created');
}
