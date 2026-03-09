import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNotionClient = {
  pages: {
    create: vi.fn(),
  },
};

vi.mock('@notionhq/client', () => ({
  Client: vi.fn(() => mockNotionClient),
}));

vi.mock('../../config/index.js', () => ({
  config: {
    NOTION_API_KEY: 'test-key',
    NOTION_ISSUE_DATABASE_ID: 'test-db-id',
    LOG_LEVEL: 'silent',
  },
}));

vi.mock('../../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import type { PipelineContext } from '../types.js';
import { createNotionIssueStep } from './create-notion-issue.js';

describe('createNotionIssueStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotionClient.pages.create.mockResolvedValue({ url: 'https://notion.so/test-page' });
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
        acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
      },
      ...overrides,
    };
  }

  it('should create a Notion page with correct properties', async () => {
    const ctx = makeCtx();
    await createNotionIssueStep(ctx);

    expect(mockNotionClient.pages.create).toHaveBeenCalledOnce();
    const callArgs = mockNotionClient.pages.create.mock.calls[0][0];
    expect(callArgs.parent.database_id).toBe('test-db-id');
    expect(callArgs.properties.Title.title[0].text.content).toBe('Test Feature');
    expect(callArgs.properties.Description.rich_text[0].text.content).toBe('Test description');
    expect(callArgs.properties.Type.select.name).toBe('feature');
    expect(callArgs.properties.Priority.select.name).toBe('medium');
    expect(callArgs.properties['Target Repo'].rich_text[0].text.content).toBe('owner/repo');
    expect(callArgs.properties['Acceptance Criteria'].rich_text[0].text.content).toContain('Criterion 1');
    expect(callArgs.properties['Acceptance Criteria'].rich_text[0].text.content).toContain('Criterion 2');
    expect(callArgs.properties['AI Confidence']).toBeUndefined(); // AI Confidence should no longer be present
    expect(ctx.notionPageUrl).toBe('https://notion.so/test-page');
  });

  it('should skip Notion issue creation if NOTION_API_KEY is missing', async () => {
    vi.mock('../../config/index.js', () => ({
      config: {
        NOTION_API_KEY: undefined, // Missing key
        NOTION_ISSUE_DATABASE_ID: 'test-db-id',
        LOG_LEVEL: 'silent',
      },
    }));
    const ctx = makeCtx();
    await createNotionIssueStep(ctx);
    expect(mockNotionClient.pages.create).not.toHaveBeenCalled();
  });

  it('should handle missing targetRepo and acceptanceCriteria gracefully', async () => {
    const ctx = makeCtx({
      request: {
        ...makeCtx().request,
        targetRepo: null,
        acceptanceCriteria: null,
      },
    });
    await createNotionIssueStep(ctx);

    const callArgs = mockNotionClient.pages.create.mock.calls[0][0];
    expect(callArgs.properties['Target Repo']).toBeUndefined();
    expect(callArgs.properties['Acceptance Criteria']).toBeUndefined();
  });
});
