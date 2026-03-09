import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../config/index.js';
import { NotionService } from '../../services/notion.service.js';
import type { PipelineContext } from '../types.js';
import { createNotionIssueStep } from './create-notion-issue.js';

vi.mock('../../config/index.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    NOTION_API_KEY: 'test-key',
    NOTION_ISSUE_DATABASE_ID: 'test-db-id',
  },
}));

const mockCreatePage = vi.fn();

vi.mock('../../services/notion.service.js', () => ({
  NotionService: vi.fn().mockImplementation(() => ({
    createPage: mockCreatePage,
  })),
}));

describe('createNotionIssueStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePage.mockResolvedValue({ url: 'https://notion.so/test-page' });
  });

  function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
    return {
      jobId: 'job-1',
      correlationId: 'test-correlation-id',
      channelId: 'C123',
      threadTs: 'ts123',
      userId: 'U123',
      request: {
        type: 'feature',
        title: 'Test Feature',
        description: 'Test description',
        targetRepo: 'owner/repo',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
        acceptanceCriteria: null,
      },
      ...overrides,
    };
  }

  it('should create a Notion page with correct properties', async () => {
    const ctx = makeCtx();
    await createNotionIssueStep(ctx);

    expect(mockCreatePage).toHaveBeenCalledOnce();
    const args = mockCreatePage.mock.calls[0][0];
    expect(args.databaseId).toBe(config.NOTION_ISSUE_DATABASE_ID);
    expect(args.properties.Name.title[0].text.content).toBe('Test Feature');
    expect(args.properties.Description.rich_text[0].text.content).toBe('Test description');
    expect(args.properties.Type.select.name).toBe('feature');
    expect(args.properties.Priority.select.name).toBe('medium');
    expect(args.properties.Repository.rich_text[0].text.content).toBe('owner/repo');
    expect(args.properties.Status.select.name).toBe('Backlog');
    expect(args.properties).not.toHaveProperty('AI Confidence'); // Assert that AI Confidence is NOT present
    expect(ctx.notionPageUrl).toBe('https://notion.so/test-page');
  });

  it('should not create Notion page if Notion API key or database ID is not configured', async () => {
    // Temporarily override config for this test
    const originalApiKey = config.NOTION_API_KEY;
    const originalDbId = config.NOTION_ISSUE_DATABASE_ID;
    config.NOTION_API_KEY = undefined;
    config.NOTION_ISSUE_DATABASE_ID = undefined;

    const ctx = makeCtx();
    await createNotionIssueStep(ctx);

    expect(mockCreatePage).not.toHaveBeenCalled();
    expect(ctx.notionPageUrl).toBeUndefined();

    // Restore config
    config.NOTION_API_KEY = originalApiKey;
    config.NOTION_ISSUE_DATABASE_ID = originalDbId;
  });

  it('should create Notion page even if targetRepo is null', async () => {
    const ctx = makeCtx({ request: { ...makeCtx().request, targetRepo: null } });
    await createNotionIssueStep(ctx);

    expect(mockCreatePage).toHaveBeenCalledOnce();
    const args = mockCreatePage.mock.calls[0][0];
    expect(args.properties.Repository.rich_text).toEqual([]);
    expect(ctx.notionPageUrl).toBe('https://notion.so/test-page');
  });

  it('should include missingInfo in description if present', async () => {
    const ctx = makeCtx({
      request: {
        ...makeCtx().request,
        missingInfo: ['repo name', 'acceptance criteria'],
      },
    });
    await createNotionIssueStep(ctx);

    const args = mockCreatePage.mock.calls[0][0];
    expect(args.properties.Description.rich_text[0].text.content).toContain(
      'Test description\n\nMissing Info:\n- repo name\n- acceptance criteria',
    );
  });

  it('should include acceptanceCriteria in description if present', async () => {
    const ctx = makeCtx({
      request: {
        ...makeCtx().request,
        acceptanceCriteria: ['AC1', 'AC2'],
      },
    });
    await createNotionIssueStep(ctx);

    const args = mockCreatePage.mock.calls[0][0];
    expect(args.properties.Description.rich_text[0].text.content).toContain(
      'Test description\n\nAcceptance Criteria:\n- AC1\n- AC2',
    );
  });
});
