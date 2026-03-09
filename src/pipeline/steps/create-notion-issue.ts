import { createLogger } from '../../lib/logger.js';
import { config } from '../../config/index.js';
import { NotionService } from '../../services/notion.service.js';
import type { PipelineContext } from '../types.js';

const log = createLogger('create-notion-issue');

export async function createNotionIssueStep(ctx: PipelineContext): Promise<void> {
  const { request, correlationId } = ctx;

  if (!config.NOTION_API_KEY || !config.NOTION_ISSUE_DATABASE_ID) {
    log.warn(
      { correlationId },
      'Skipping Notion issue creation: Notion API key or database ID not configured',
    );
    return;
  }

  const notion = new NotionService(correlationId);

  log.info({ correlationId, title: request.title }, 'Creating Notion issue');

  let descriptionContent = request.description;
  if (request.missingInfo && request.missingInfo.length > 0) {
    descriptionContent += `\n\nMissing Info:\n${request.missingInfo.map((info) => `- ${info}`).join('\n')}`;
  }
  if (request.acceptanceCriteria && request.acceptanceCriteria.length > 0) {
    descriptionContent += `\n\nAcceptance Criteria:\n${request.acceptanceCriteria.map((ac) => `- ${ac}`).join('\n')}`;
  }

  const page = await notion.createPage({
    databaseId: config.NOTION_ISSUE_DATABASE_ID,
    properties: {
      Name: {
        title: [{ text: { content: request.title } }],
      },
      Description: {
        rich_text: [{ text: { content: descriptionContent } }],
      },
      Type: {
        select: { name: request.type },
      },
      Priority: {
        select: { name: request.priority },
      },
      Repository: request.targetRepo
        ? { rich_text: [{ text: { content: request.targetRepo } }] }
        : { rich_text: [] },
      Status: {
        select: { name: 'Backlog' }, // Default status
      },
    },
  });

  ctx.notionPageUrl = page.url;
  log.info({ correlationId, notionPageUrl: page.url }, 'Notion issue created');
}
