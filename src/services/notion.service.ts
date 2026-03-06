import { Client } from '@notionhq/client';
import { config } from '../config/index.js';
import { CircuitBreaker } from '../lib/circuit-breaker.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('notion-service');

const notionCircuitBreaker = new CircuitBreaker({
  name: 'notion',
  failureThreshold: 5,
  resetTimeoutMs: 60000,
});

let notionClient: Client | null = null;
let notionUsersCache: Map<string, string> | null = null;

export function isNotionConfigured(): boolean {
  return !!(config.NOTION_API_KEY && config.NOTION_ISSUE_DATABASE_ID);
}

function getNotionClient(): Client {
  if (notionClient) return notionClient;

  if (!config.NOTION_API_KEY) {
    throw new Error('NOTION_API_KEY is not configured');
  }

  notionClient = new Client({ auth: config.NOTION_API_KEY });
  return notionClient;
}

async function withNotionMetrics<T>(fn: () => Promise<T>): Promise<T> {
  return notionCircuitBreaker.execute(fn);
}

export function buildRepoUrl(targetRepo: string): string {
  if (targetRepo.startsWith('http')) return targetRepo;
  const parts = targetRepo.split('/');
  if (parts.length === 2) {
    return `https://github.com/${parts[0]}/${parts[1]}`;
  }
  if (config.GITHUB_DEFAULT_ORG) {
    return `https://github.com/${config.GITHUB_DEFAULT_ORG}/${targetRepo}`;
  }
  return `https://github.com/${targetRepo}`;
}

async function loadNotionUsers(): Promise<Map<string, string>> {
  if (notionUsersCache) return notionUsersCache;

  notionUsersCache = new Map();
  try {
    const client = getNotionClient();
    const response = await client.users.list({});
    for (const user of response.results) {
      if (user.type === 'person' && 'person' in user && user.person?.email) {
        notionUsersCache.set(user.person.email.toLowerCase(), user.id);
      }
    }
    logger.info({ count: notionUsersCache.size }, 'Loaded Notion users');
  } catch (err) {
    logger.warn({ err }, 'Failed to load Notion users');
  }
  return notionUsersCache;
}

export async function resolveNotionUserId(email: string): Promise<string | null> {
  const users = await loadNotionUsers();
  return users.get(email.toLowerCase()) ?? null;
}

/** @internal 테스트 전용 */
export function _resetNotionUsersCache(): void {
  notionUsersCache = null;
}

export interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface CreateNotionIssueParams {
  title: string;
  type: string;
  priority: string;
  description: string;
  repositoryUrl: string;
  notionUserId?: string | null;
  slackPermalink?: string;
  confidence: number;
  acceptanceCriteria?: string[] | null;
  conversationHistory?: ConversationEntry[];
}

export interface NotionIssueResult {
  pageId: string;
  pageUrl: string;
}

type NotionBlock = Record<string, unknown>;

function heading2(text: string): NotionBlock {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: text } }] } };
}

function paragraph(text: string): NotionBlock {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } };
}

function emptyParagraph(): NotionBlock {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: [] } };
}

function divider(): NotionBlock {
  return { object: 'block', type: 'divider', divider: {} };
}

function callout(text: string, emoji: string): NotionBlock {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      icon: { type: 'emoji', emoji },
      rich_text: [{ type: 'text', text: { content: text } }],
    },
  };
}

function todoItem(text: string): NotionBlock {
  return { object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: text } }], checked: false } };
}

function quote(text: string): NotionBlock {
  return { object: 'block', type: 'quote', quote: { rich_text: [{ type: 'text', text: { content: text } }] } };
}

function numberedItem(text: string): NotionBlock {
  return { object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ type: 'text', text: { content: text } }] } };
}

function bulletItem(text: string): NotionBlock {
  return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] } };
}

function buildTypeSpecificBlocks(type: string): NotionBlock[] {
  switch (type) {
    case 'fix':
      return [
        heading2('Steps to Reproduce'),
        numberedItem('...'),
        emptyParagraph(),
        heading2('Expected vs Actual'),
        callout('Expected: (정상 동작을 작성해주세요)', '✅'),
        callout('Actual: (현재 발생하는 문제를 작성해주세요)', '❌'),
      ];
    case 'feature':
      return [
        heading2('User Story'),
        callout('As a [사용자], I want [기능] so that [가치]', '👤'),
        emptyParagraph(),
        heading2('Scope'),
        bulletItem('포함:'),
        bulletItem('제외:'),
      ];
    case 'refactor':
      return [
        heading2('Current Problem'),
        callout('현재 코드/구조의 문제점을 작성해주세요', '⚠️'),
        emptyParagraph(),
        heading2('Proposed Change'),
        paragraph('변경 방향 및 접근 방식을 작성해주세요'),
      ];
    default:
      return [];
  }
}

export function buildNotionPageBlocks(params: CreateNotionIssueParams): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  // Summary
  blocks.push(heading2('Summary'));
  blocks.push(paragraph(params.description));
  blocks.push(emptyParagraph());

  // Type-specific sections
  const typeBlocks = buildTypeSpecificBlocks(params.type);
  if (typeBlocks.length > 0) {
    blocks.push(...typeBlocks);
    blocks.push(emptyParagraph());
  }

  // Acceptance Criteria
  if (params.acceptanceCriteria?.length) {
    blocks.push(heading2('Acceptance Criteria'));
    for (const criterion of params.acceptanceCriteria) {
      blocks.push(todoItem(criterion));
    }
    blocks.push(emptyParagraph());
  }

  // Conversation Context
  if (params.conversationHistory?.length) {
    blocks.push(heading2('Conversation Context'));
    for (const msg of params.conversationHistory) {
      const role = msg.role === 'user' ? 'User' : 'Bot';
      blocks.push(quote(`${role}: ${msg.content}`));
    }
    blocks.push(emptyParagraph());
  }

  // References
  blocks.push(divider());
  blocks.push(callout('Created by CodePilot', '🤖'));

  return blocks;
}

export async function createNotionIssue(params: CreateNotionIssueParams): Promise<NotionIssueResult> {
  return withNotionMetrics(async () => {
    const client = getNotionClient();
    const databaseId = config.NOTION_ISSUE_DATABASE_ID as string;

    const properties: Record<string, unknown> = {
      Name: {
        title: [{ text: { content: params.title } }],
      },
      Type: {
        select: { name: params.type },
      },
      Priority: {
        select: { name: params.priority },
      },
      Repository: {
        url: params.repositoryUrl,
      },
      'AI Confidence': {
        number: params.confidence,
      },
    };

    if (params.notionUserId) {
      properties['Requested By'] = {
        people: [{ id: params.notionUserId }],
      };
    }

    if (params.slackPermalink) {
      properties['Slack Thread'] = {
        url: params.slackPermalink,
      };
    }

    const children = buildNotionPageBlocks(params);

    const response = await client.pages.create({
      parent: { database_id: databaseId },
      properties: properties as Parameters<typeof client.pages.create>[0]['properties'],
      children: children as Parameters<typeof client.pages.create>[0]['children'],
    });

    const pageUrl = (response as { url: string }).url;
    logger.info({ pageId: response.id, pageUrl }, 'Created Notion issue');

    return { pageId: response.id, pageUrl };
  });
}

export async function updateNotionIssueWithGitHub(
  pageId: string,
  githubIssueUrl: string,
): Promise<void> {
  return withNotionMetrics(async () => {
    const client = getNotionClient();
    await client.pages.update({
      page_id: pageId,
      properties: {
        'GitHub Issue': { url: githubIssueUrl },
      } as Parameters<typeof client.pages.update>[0]['properties'],
    });
    logger.info({ pageId, githubIssueUrl }, 'Updated Notion issue with GitHub link');
  });
}

export async function updateNotionIssueWithPR(
  pageId: string,
  githubPrUrl: string,
): Promise<void> {
  return withNotionMetrics(async () => {
    const client = getNotionClient();
    await client.pages.update({
      page_id: pageId,
      properties: {
        'GitHub PR': { url: githubPrUrl },
      } as Parameters<typeof client.pages.update>[0]['properties'],
    });
    logger.info({ pageId, githubPrUrl }, 'Updated Notion issue with PR link');
  });
}
