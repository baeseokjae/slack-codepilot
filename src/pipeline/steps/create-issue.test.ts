import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent', SLACK_GITHUB_USER_MAP: undefined },
}));

vi.mock('../../services/github.service.js', () => ({
  resolveRepo: vi.fn(),
  createIssue: vi.fn(),
  searchGitHubUserByEmail: vi.fn(),
}));

vi.mock('../../services/slack-notifier.service.js', () => ({
  getSlackUserEmail: vi.fn(),
}));

import { config } from '../../config/index.js';
import { createIssue, resolveRepo, searchGitHubUserByEmail } from '../../services/github.service.js';
import { getSlackUserEmail } from '../../services/slack-notifier.service.js';
import type { PipelineContext } from '../types.js';
import { _resetUserMapCache, buildIssueBody, createIssueStep } from './create-issue.js';

const mockResolveRepo = vi.mocked(resolveRepo);
const mockCreateIssue = vi.mocked(createIssue);
const mockGetSlackUserEmail = vi.mocked(getSlackUserEmail);
const mockSearchGitHubUserByEmail = vi.mocked(searchGitHubUserByEmail);

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    jobId: 'job-1',
    correlationId: 'test-correlation-id',
    channelId: 'C123',
    threadTs: 'ts123',
    userId: 'U123',
    request: {
      type: 'feature',
      title: '새 기능 추가',
      description: '로그인 기능',
      targetRepo: 'owner/repo',
      priority: 'medium',
      confidence: 0.9,
      missingInfo: null,
    },
    ...overrides,
  };
}

describe('createIssueStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetUserMapCache();
    Object.assign(config, { SLACK_GITHUB_USER_MAP: undefined });
    mockResolveRepo.mockResolvedValue({
      owner: 'owner',
      repo: 'repo',
      defaultBranch: 'main',
    });
    // 기본: assignee 매핑 실패 (기존 테스트 영향 없음)
    mockGetSlackUserEmail.mockResolvedValue(null);
    mockSearchGitHubUserByEmail.mockResolvedValue(null);
  });

  it('should throw when targetRepo is null', async () => {
    const ctx = makeCtx({
      request: {
        type: 'feature',
        title: 'test',
        description: 'test',
        targetRepo: null,
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
    });

    await expect(createIssueStep(ctx)).rejects.toThrow('targetRepo is required');
  });

  it('should create a new issue when none exists', async () => {
    const ctx = makeCtx();

    mockCreateIssue.mockResolvedValue({
      number: 42,
      url: 'https://github.com/owner/repo/issues/42',
    });

    await createIssueStep(ctx);

    expect(ctx.issueNumber).toBe(42);
    expect(ctx.issueUrl).toBe('https://github.com/owner/repo/issues/42');
    expect(mockCreateIssue).toHaveBeenCalledOnce();
    expect(mockCreateIssue.mock.calls[0][0].title).toBe('[CodePilot] 새 기능 추가');
    expect(mockCreateIssue.mock.calls[0][0].labels).toContain('enhancement');
    expect(mockCreateIssue.mock.calls[0][0].labels).toContain('codepilot');
  });

  it('should set repoInfo on context', async () => {
    const ctx = makeCtx();

    mockCreateIssue.mockResolvedValue({ number: 1, url: 'https://example.com' });

    await createIssueStep(ctx);

    expect(ctx.repoInfo).toEqual({ owner: 'owner', repo: 'repo', defaultBranch: 'main' });
  });

  it('should assign GitHub user when Slack email maps to a GitHub account', async () => {
    const ctx = makeCtx();

    mockCreateIssue.mockResolvedValue({ number: 42, url: 'https://github.com/owner/repo/issues/42' });
    mockGetSlackUserEmail.mockResolvedValue('dev@example.com');
    mockSearchGitHubUserByEmail.mockResolvedValue('github-dev');

    await createIssueStep(ctx);

    expect(mockGetSlackUserEmail).toHaveBeenCalledWith('U123');
    expect(mockSearchGitHubUserByEmail).toHaveBeenCalledWith('dev@example.com');
    expect(mockCreateIssue.mock.calls[0][0].assignees).toEqual(['github-dev']);
  });

  it('should create issue without assignees when email lookup fails', async () => {
    const ctx = makeCtx();

    mockCreateIssue.mockResolvedValue({ number: 42, url: 'https://github.com/owner/repo/issues/42' });
    mockGetSlackUserEmail.mockResolvedValue(null);

    await createIssueStep(ctx);

    expect(mockSearchGitHubUserByEmail).not.toHaveBeenCalled();
    expect(mockCreateIssue.mock.calls[0][0].assignees).toEqual([]);
  });

  it('should create issue without assignees when GitHub user not found', async () => {
    const ctx = makeCtx();

    mockCreateIssue.mockResolvedValue({ number: 42, url: 'https://github.com/owner/repo/issues/42' });
    mockGetSlackUserEmail.mockResolvedValue('unknown@example.com');
    mockSearchGitHubUserByEmail.mockResolvedValue(null);

    await createIssueStep(ctx);

    expect(mockCreateIssue.mock.calls[0][0].assignees).toEqual([]);
  });

  it('should resolve assignee from SLACK_GITHUB_USER_MAP when configured', async () => {
    Object.assign(config, { SLACK_GITHUB_USER_MAP: 'U123:mapped-user,U456:other-user' });
    _resetUserMapCache();
    const ctx = makeCtx();

    mockCreateIssue.mockResolvedValue({ number: 42, url: 'https://github.com/owner/repo/issues/42' });

    await createIssueStep(ctx);

    // env map에서 직접 조회하므로 email/GitHub 검색 불필요
    expect(mockGetSlackUserEmail).not.toHaveBeenCalled();
    expect(mockSearchGitHubUserByEmail).not.toHaveBeenCalled();
    expect(mockCreateIssue.mock.calls[0][0].assignees).toEqual(['mapped-user']);
    expect(ctx.githubUsername).toBe('mapped-user');
  });

  it('should fall back to email lookup when user not in SLACK_GITHUB_USER_MAP', async () => {
    Object.assign(config, { SLACK_GITHUB_USER_MAP: 'U999:some-user' });
    _resetUserMapCache();
    const ctx = makeCtx(); // userId is U123, not in the map

    mockCreateIssue.mockResolvedValue({ number: 42, url: 'https://github.com/owner/repo/issues/42' });
    mockGetSlackUserEmail.mockResolvedValue('dev@example.com');
    mockSearchGitHubUserByEmail.mockResolvedValue('github-dev');

    await createIssueStep(ctx);

    expect(mockGetSlackUserEmail).toHaveBeenCalledWith('U123');
    expect(mockCreateIssue.mock.calls[0][0].assignees).toEqual(['github-dev']);
  });

  it('should set githubUsername on context when assignee resolved via email', async () => {
    const ctx = makeCtx();

    mockCreateIssue.mockResolvedValue({ number: 42, url: 'https://github.com/owner/repo/issues/42' });
    mockGetSlackUserEmail.mockResolvedValue('dev@example.com');
    mockSearchGitHubUserByEmail.mockResolvedValue('github-dev');

    await createIssueStep(ctx);

    expect(ctx.githubUsername).toBe('github-dev');
  });

  it('should pass buildIssueBody result as issue body', async () => {
    const ctx = makeCtx();

    mockCreateIssue.mockResolvedValue({ number: 42, url: 'https://github.com/owner/repo/issues/42' });

    await createIssueStep(ctx);

    const body = mockCreateIssue.mock.calls[0][0].body;
    expect(body).toContain('Feature Request');
    expect(body).toContain('새 기능 추가');
    expect(body).toContain('로그인 기능');
    expect(body).toContain('🟡 Medium');
    expect(body).toContain('`owner/repo`');
    expect(body).toContain('CodePilot');
  });

  it('should map fix type to bug label', async () => {
    const ctx = makeCtx({
      request: {
        type: 'fix',
        title: '버그 수정',
        description: '에러 발생',
        targetRepo: 'owner/repo',
        priority: 'high',
        confidence: 0.9,
        missingInfo: null,
      },
    });

    mockCreateIssue.mockResolvedValue({ number: 1, url: 'https://example.com' });

    await createIssueStep(ctx);

    expect(mockCreateIssue.mock.calls[0][0].labels).toContain('bug');
  });
});

describe('buildIssueBody', () => {
  it('should include type emoji, display name, and title in header', () => {
    const body = buildIssueBody(
      {
        type: 'feature',
        title: '새 기능 추가',
        description: '로그인 기능 구현',
        targetRepo: 'owner/repo',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
      'U123',
    );

    expect(body).toContain('## ✨ Feature Request: 새 기능 추가');
  });

  it('should include description section', () => {
    const body = buildIssueBody(
      {
        type: 'fix',
        title: '버그 수정',
        description: '로그인 시 에러 발생',
        targetRepo: 'owner/repo',
        priority: 'high',
        confidence: 0.9,
        missingInfo: null,
      },
      'U456',
    );

    expect(body).toContain('### Description');
    expect(body).toContain('로그인 시 에러 발생');
  });

  it('should include details table with priority and repo', () => {
    const body = buildIssueBody(
      {
        type: 'refactor',
        title: '코드 정리',
        description: '레거시 코드 리팩토링',
        targetRepo: 'org/my-repo',
        priority: 'low',
        confidence: 0.85,
        missingInfo: null,
      },
      'U789',
    );

    expect(body).toContain('### Details');
    expect(body).toContain('🟢 Low');
    expect(body).toContain('`org/my-repo`');
    expect(body).toContain('Refactoring');
  });

  it('should render correct emoji for each type', () => {
    const types = [
      { type: 'feature' as const, emoji: '✨' },
      { type: 'fix' as const, emoji: '🐛' },
      { type: 'refactor' as const, emoji: '♻️' },
      { type: 'docs' as const, emoji: '📝' },
      { type: 'test' as const, emoji: '🧪' },
    ];

    for (const { type, emoji } of types) {
      const body = buildIssueBody(
        {
          type,
          title: 'test',
          description: 'desc',
          targetRepo: 'o/r',
          priority: 'medium',
          confidence: 0.9,
          missingInfo: null,
        },
        'U1',
      );
      expect(body).toContain(emoji);
    }
  });

  it('should include CodePilot footer', () => {
    const body = buildIssueBody(
      {
        type: 'feature',
        title: 'test',
        description: 'desc',
        targetRepo: 'o/r',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
      'U1',
    );

    expect(body).toContain('automatically created by');
    expect(body).toContain('CodePilot');
    expect(body).toContain('Slack conversation');
  });
});
