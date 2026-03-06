import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../lib/circuit-breaker.js', () => ({
  CircuitBreaker: vi.fn().mockImplementation(() => ({
    execute: vi.fn((fn: () => Promise<unknown>) => fn()),
  })),
}));

const mockPagesCreate = vi.fn();
const mockPagesUpdate = vi.fn();
const mockUsersList = vi.fn();

vi.mock('@notionhq/client', () => ({
  Client: vi.fn().mockImplementation(() => ({
    pages: {
      create: mockPagesCreate,
      update: mockPagesUpdate,
    },
    users: {
      list: mockUsersList,
    },
  })),
}));

vi.mock('../config/index.js', () => ({
  config: {
    NOTION_API_KEY: 'ntn_test_key',
    NOTION_ISSUE_DATABASE_ID: 'test-db-id',
    GITHUB_DEFAULT_ORG: 'test-org',
  },
}));

import {
  _resetNotionUsersCache,
  buildNotionPageBlocks,
  buildRepoUrl,
  createNotionIssue,
  isNotionConfigured,
  resolveNotionUserId,
  updateNotionIssueWithGitHub,
  updateNotionIssueWithPR,
} from './notion.service.js';

describe('notion.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildRepoUrl', () => {
    it('should return as-is if already a URL', () => {
      expect(buildRepoUrl('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
    });

    it('should construct URL from owner/repo format', () => {
      expect(buildRepoUrl('owner/repo')).toBe('https://github.com/owner/repo');
    });

    it('should use GITHUB_DEFAULT_ORG for bare repo name', () => {
      expect(buildRepoUrl('my-repo')).toBe('https://github.com/test-org/my-repo');
    });
  });

  describe('resolveNotionUserId', () => {
    beforeEach(() => {
      _resetNotionUsersCache();
    });

    it('should return Notion user ID matching by email', async () => {
      mockUsersList.mockResolvedValue({
        results: [
          { type: 'person', person: { email: 'user@example.com' }, id: 'notion-user-1' },
        ],
      });

      const result = await resolveNotionUserId('user@example.com');
      expect(result).toBe('notion-user-1');
    });

    it('should return null when no match', async () => {
      mockUsersList.mockResolvedValue({ results: [] });

      const result = await resolveNotionUserId('unknown@example.com');
      expect(result).toBeNull();
    });

    it('should be case-insensitive', async () => {
      mockUsersList.mockResolvedValue({
        results: [
          { type: 'person', person: { email: 'User@Example.COM' }, id: 'notion-user-2' },
        ],
      });

      const result = await resolveNotionUserId('user@example.com');
      expect(result).toBe('notion-user-2');
    });
  });

  describe('isNotionConfigured', () => {
    it('should return true when both keys are set', () => {
      expect(isNotionConfigured()).toBe(true);
    });
  });

  describe('createNotionIssue', () => {
    it('should create a page in the Notion database', async () => {
      mockPagesCreate.mockResolvedValue({
        id: 'page-123',
        url: 'https://notion.so/page-123',
      });

      const result = await createNotionIssue({
        title: '[CodePilot] Test Feature',
        type: 'feature',
        priority: 'high',
        description: 'Test description',
        repositoryUrl: 'https://github.com/owner/repo',
        notionUserId: 'notion-user-123',
        slackPermalink: 'https://slack.com/archives/C123/p1234',
        confidence: 0.95,
      });

      expect(result).toEqual({
        pageId: 'page-123',
        pageUrl: 'https://notion.so/page-123',
      });

      expect(mockPagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: 'test-db-id' },
          properties: expect.objectContaining({
            Name: { title: [{ text: { content: '[CodePilot] Test Feature' } }] },
            Type: { select: { name: 'feature' } },
            Priority: { select: { name: 'high' } },
            Repository: { url: 'https://github.com/owner/repo' },
            'Requested By': { people: [{ id: 'notion-user-123' }] },
            'AI Confidence': { number: 0.95 },
            'Slack Thread': { url: 'https://slack.com/archives/C123/p1234' },
          }),
        }),
      );
    });

    it('should omit Slack Thread when no permalink provided', async () => {
      mockPagesCreate.mockResolvedValue({
        id: 'page-456',
        url: 'https://notion.so/page-456',
      });

      await createNotionIssue({
        title: 'Test',
        type: 'fix',
        priority: 'low',
        description: 'desc',
        repositoryUrl: 'https://github.com/test-org/repo',
        confidence: 0.8,
      });

      const callArgs = mockPagesCreate.mock.calls[0][0];
      expect(callArgs.properties['Slack Thread']).toBeUndefined();
      expect(callArgs.properties['Requested By']).toBeUndefined();
    });
  });

  describe('buildNotionPageBlocks', () => {
    const baseParams = {
      title: 'Test',
      type: 'feature' as string,
      priority: 'high',
      description: 'Test description',
      repositoryUrl: 'https://github.com/owner/repo',
      confidence: 0.9,
    };

    it('should include Summary section', () => {
      const blocks = buildNotionPageBlocks(baseParams);
      expect(blocks[0]).toEqual(expect.objectContaining({ type: 'heading_2' }));
      expect(blocks[0].heading_2).toEqual(
        expect.objectContaining({ rich_text: [expect.objectContaining({ text: { content: 'Summary' } })] }),
      );
      expect(blocks[1]).toEqual(expect.objectContaining({ type: 'paragraph' }));
    });

    it('should include User Story and Scope for feature type', () => {
      const blocks = buildNotionPageBlocks(baseParams);
      const headings = blocks.filter((b) => b.type === 'heading_2').map((b) => (b.heading_2 as { rich_text: { text: { content: string } }[] }).rich_text[0].text.content);
      expect(headings).toContain('User Story');
      expect(headings).toContain('Scope');
    });

    it('should include Steps to Reproduce and Expected vs Actual for fix type', () => {
      const blocks = buildNotionPageBlocks({ ...baseParams, type: 'fix' });
      const headings = blocks.filter((b) => b.type === 'heading_2').map((b) => (b.heading_2 as { rich_text: { text: { content: string } }[] }).rich_text[0].text.content);
      expect(headings).toContain('Steps to Reproduce');
      expect(headings).toContain('Expected vs Actual');
    });

    it('should include Current Problem and Proposed Change for refactor type', () => {
      const blocks = buildNotionPageBlocks({ ...baseParams, type: 'refactor' });
      const headings = blocks.filter((b) => b.type === 'heading_2').map((b) => (b.heading_2 as { rich_text: { text: { content: string } }[] }).rich_text[0].text.content);
      expect(headings).toContain('Current Problem');
      expect(headings).toContain('Proposed Change');
    });

    it('should include acceptance criteria as to_do blocks', () => {
      const blocks = buildNotionPageBlocks({
        ...baseParams,
        acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
      });
      const todos = blocks.filter((b) => b.type === 'to_do');
      expect(todos).toHaveLength(2);
    });

    it('should include conversation history as quote blocks', () => {
      const blocks = buildNotionPageBlocks({
        ...baseParams,
        conversationHistory: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
      });
      const quotes = blocks.filter((b) => b.type === 'quote');
      expect(quotes).toHaveLength(2);
    });

    it('should end with divider and CodePilot callout', () => {
      const blocks = buildNotionPageBlocks(baseParams);
      const lastTwo = blocks.slice(-2);
      expect(lastTwo[0].type).toBe('divider');
      expect(lastTwo[1].type).toBe('callout');
    });

    it('should not include type-specific sections for docs type', () => {
      const blocks = buildNotionPageBlocks({ ...baseParams, type: 'docs' });
      const headings = blocks.filter((b) => b.type === 'heading_2').map((b) => (b.heading_2 as { rich_text: { text: { content: string } }[] }).rich_text[0].text.content);
      expect(headings).not.toContain('User Story');
      expect(headings).not.toContain('Steps to Reproduce');
      expect(headings).not.toContain('Current Problem');
    });
  });

  describe('updateNotionIssueWithGitHub', () => {
    it('should update page with GitHub issue URL', async () => {
      mockPagesUpdate.mockResolvedValue({});

      await updateNotionIssueWithGitHub('page-123', 'https://github.com/owner/repo/issues/1');

      expect(mockPagesUpdate).toHaveBeenCalledWith({
        page_id: 'page-123',
        properties: {
          'GitHub Issue': { url: 'https://github.com/owner/repo/issues/1' },
        },
      });
    });
  });

  describe('updateNotionIssueWithPR', () => {
    it('should update page with GitHub PR URL', async () => {
      mockPagesUpdate.mockResolvedValue({});

      await updateNotionIssueWithPR('page-123', 'https://github.com/owner/repo/pull/2');

      expect(mockPagesUpdate).toHaveBeenCalledWith({
        page_id: 'page-123',
        properties: {
          'GitHub PR': { url: 'https://github.com/owner/repo/pull/2' },
        },
      });
    });
  });
});
