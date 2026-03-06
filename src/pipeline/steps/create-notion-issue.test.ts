import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockIsNotionConfigured = vi.fn();
const mockCreateNotionIssue = vi.fn();
const mockUpdateNotionIssueWithGitHub = vi.fn();
const mockBuildRepoUrl = vi.fn();
const mockResolveNotionUserId = vi.fn();

vi.mock('../../services/notion.service.js', () => ({
  isNotionConfigured: (...args: unknown[]) => mockIsNotionConfigured(...args),
  createNotionIssue: (...args: unknown[]) => mockCreateNotionIssue(...args),
  updateNotionIssueWithGitHub: (...args: unknown[]) => mockUpdateNotionIssueWithGitHub(...args),
  buildRepoUrl: (...args: unknown[]) => mockBuildRepoUrl(...args),
  resolveNotionUserId: (...args: unknown[]) => mockResolveNotionUserId(...args),
}));

const mockGetSlackUserEmail = vi.fn();

vi.mock('../../services/slack-notifier.service.js', () => ({
  getSlackUserEmail: (...args: unknown[]) => mockGetSlackUserEmail(...args),
}));

import type { PipelineContext } from '../types.js';
import { createNotionIssueStep, linkGitHubToNotion } from './create-notion-issue.js';

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    jobId: 'job-1',
    correlationId: 'corr-1',
    channelId: 'C123',
    threadTs: '1234567890.123456',
    userId: 'U123',
    request: {
      type: 'feature',
      title: 'Test Feature',
      description: 'Test description',
      targetRepo: 'owner/repo',
      priority: 'high',
      confidence: 0.95,
      missingInfo: null,
    },
    ...overrides,
  };
}

describe('createNotionIssueStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip when Notion is not configured', async () => {
    mockIsNotionConfigured.mockReturnValue(false);
    const ctx = makeCtx();

    await createNotionIssueStep(ctx);

    expect(mockCreateNotionIssue).not.toHaveBeenCalled();
    expect(ctx.notionPageId).toBeUndefined();
  });

  it('should throw when targetRepo is null', async () => {
    mockIsNotionConfigured.mockReturnValue(true);
    const ctx = makeCtx({
      request: {
        type: 'feature',
        title: 'Test',
        description: 'desc',
        targetRepo: null,
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
    });

    await expect(createNotionIssueStep(ctx)).rejects.toThrow('targetRepo is required');
  });

  it('should create a Notion issue with repo URL and Notion user', async () => {
    mockIsNotionConfigured.mockReturnValue(true);
    mockBuildRepoUrl.mockReturnValue('https://github.com/owner/repo');
    mockGetSlackUserEmail.mockResolvedValue('user@example.com');
    mockResolveNotionUserId.mockResolvedValue('notion-user-abc');
    mockCreateNotionIssue.mockResolvedValue({
      pageId: 'notion-page-123',
      pageUrl: 'https://notion.so/page-123',
    });

    const ctx = makeCtx();
    await createNotionIssueStep(ctx);

    expect(mockBuildRepoUrl).toHaveBeenCalledWith('owner/repo');
    expect(mockGetSlackUserEmail).toHaveBeenCalledWith('U123');
    expect(mockResolveNotionUserId).toHaveBeenCalledWith('user@example.com');
    expect(mockCreateNotionIssue).toHaveBeenCalledWith({
      title: '[CodePilot] Test Feature',
      type: 'feature',
      priority: 'high',
      description: 'Test description',
      repositoryUrl: 'https://github.com/owner/repo',
      notionUserId: 'notion-user-abc',
      slackPermalink: 'https://slack.com/archives/C123/p1234567890123456',
      confidence: 0.95,
      acceptanceCriteria: undefined,
      conversationHistory: undefined,
    });

    expect(ctx.notionPageId).toBe('notion-page-123');
    expect(ctx.notionPageUrl).toBe('https://notion.so/page-123');
  });

  it('should pass null notionUserId when email not found', async () => {
    mockIsNotionConfigured.mockReturnValue(true);
    mockBuildRepoUrl.mockReturnValue('https://github.com/owner/repo');
    mockGetSlackUserEmail.mockResolvedValue(null);
    mockCreateNotionIssue.mockResolvedValue({
      pageId: 'page-1',
      pageUrl: 'https://notion.so/page-1',
    });

    const ctx = makeCtx();
    await createNotionIssueStep(ctx);

    expect(mockCreateNotionIssue).toHaveBeenCalledWith(
      expect.objectContaining({ notionUserId: null }),
    );
  });
});

describe('linkGitHubToNotion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip when notionPageId is not set', async () => {
    const ctx = makeCtx();
    await linkGitHubToNotion(ctx);
    expect(mockUpdateNotionIssueWithGitHub).not.toHaveBeenCalled();
  });

  it('should skip when issueUrl is not set', async () => {
    const ctx = makeCtx({ notionPageId: 'page-1' });
    await linkGitHubToNotion(ctx);
    expect(mockUpdateNotionIssueWithGitHub).not.toHaveBeenCalled();
  });

  it('should update Notion with GitHub issue URL', async () => {
    mockUpdateNotionIssueWithGitHub.mockResolvedValue(undefined);
    const ctx = makeCtx({
      notionPageId: 'page-1',
      issueUrl: 'https://github.com/owner/repo/issues/1',
    });

    await linkGitHubToNotion(ctx);

    expect(mockUpdateNotionIssueWithGitHub).toHaveBeenCalledWith(
      'page-1',
      'https://github.com/owner/repo/issues/1',
    );
  });

  it('should not throw when update fails', async () => {
    mockUpdateNotionIssueWithGitHub.mockRejectedValue(new Error('API error'));
    const ctx = makeCtx({
      notionPageId: 'page-1',
      issueUrl: 'https://github.com/owner/repo/issues/1',
    });

    await expect(linkGitHubToNotion(ctx)).resolves.toBeUndefined();
  });
});
