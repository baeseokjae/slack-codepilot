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
import { _resetUserMapCache, buildIssueBody, buildSlackPermalink, createIssueStep } from './create-issue.js';

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
    const body = buildIssueBody({
      request: {
        type: 'feature',
        title: '새 기능 추가',
        description: '로그인 기능 구현',
        targetRepo: 'owner/repo',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
      userId: 'U123',
    });

    expect(body).toContain('## ✨ Feature Request: 새 기능 추가');
  });

  it('should include description section', () => {
    const body = buildIssueBody({
      request: {
        type: 'fix',
        title: '버그 수정',
        description: '로그인 시 에러 발생',
        targetRepo: 'owner/repo',
        priority: 'high',
        confidence: 0.9,
        missingInfo: null,
      },
      userId: 'U456',
    });

    expect(body).toContain('### Description');
    expect(body).toContain('로그인 시 에러 발생');
  });

  it('should include details table with priority and repo', () => {
    const body = buildIssueBody({
      request: {
        type: 'refactor',
        title: '코드 정리',
        description: '레거시 코드 리팩토링',
        targetRepo: 'org/my-repo',
        priority: 'low',
        confidence: 0.85,
        missingInfo: null,
      },
      userId: 'U789',
    });

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
      const body = buildIssueBody({
        request: {
          type,
          title: 'test',
          description: 'desc',
          targetRepo: 'o/r',
          priority: 'medium',
          confidence: 0.9,
          missingInfo: null,
        },
        userId: 'U1',
      });
      expect(body).toContain(emoji);
    }
  });

  it('should include CodePilot footer', () => {
    const body = buildIssueBody({
      request: {
        type: 'feature',
        title: 'test',
        description: 'desc',
        targetRepo: 'o/r',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
      userId: 'U1',
    });

    expect(body).toContain('CodePilot');
    expect(body).toContain('Created by');
  });

  it('should render acceptance criteria as checkbox list', () => {
    const body = buildIssueBody({
      request: {
        type: 'feature',
        title: '로그인 기능',
        description: '소셜 로그인 구현',
        targetRepo: 'owner/repo',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
        acceptanceCriteria: ['이메일로 로그인 가능', '비밀번호 오류 시 메시지 표시'],
      },
      userId: 'U1',
    });

    expect(body).toContain('### Acceptance Criteria');
    expect(body).toContain('- [ ] 이메일로 로그인 가능');
    expect(body).toContain('- [ ] 비밀번호 오류 시 메시지 표시');
  });

  it('should omit acceptance criteria section when null', () => {
    const body = buildIssueBody({
      request: {
        type: 'feature',
        title: 'test',
        description: 'desc',
        targetRepo: 'o/r',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
        acceptanceCriteria: null,
      },
      userId: 'U1',
    });

    expect(body).not.toContain('### Acceptance Criteria');
  });

  it('should omit acceptance criteria section when undefined', () => {
    const body = buildIssueBody({
      request: {
        type: 'feature',
        title: 'test',
        description: 'desc',
        targetRepo: 'o/r',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
      userId: 'U1',
    });

    expect(body).not.toContain('### Acceptance Criteria');
  });

  it('should show AI confidence as percentage in details table', () => {
    const body = buildIssueBody({
      request: {
        type: 'feature',
        title: 'test',
        description: 'desc',
        targetRepo: 'o/r',
        priority: 'medium',
        confidence: 0.92,
        missingInfo: null,
      },
      userId: 'U1',
    });

    expect(body).toContain('**AI Confidence**');
    expect(body).toContain('92%');
  });

  it('should render conversation history in details block', () => {
    const body = buildIssueBody({
      request: {
        type: 'feature',
        title: 'test',
        description: 'desc',
        targetRepo: 'o/r',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
      userId: 'U1',
      conversationHistory: [
        { role: 'user', content: '로그인 기능 추가해줘', timestamp: '1000' },
        { role: 'assistant', content: '어떤 방식의 로그인인가요?', timestamp: '1001' },
      ],
    });

    expect(body).toContain('<details>');
    expect(body).toContain('💬 Original Conversation');
    expect(body).toContain('> **User**: 로그인 기능 추가해줘');
    expect(body).toContain('> **Bot**: 어떤 방식의 로그인인가요?');
    expect(body).toContain('</details>');
  });

  it('should omit conversation history block when absent', () => {
    const body = buildIssueBody({
      request: {
        type: 'feature',
        title: 'test',
        description: 'desc',
        targetRepo: 'o/r',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
      userId: 'U1',
    });

    expect(body).not.toContain('<details>');
    expect(body).not.toContain('Original Conversation');
  });

  it('should include Slack permalink in footer when channelId and threadTs are provided', () => {
    const body = buildIssueBody({
      request: {
        type: 'feature',
        title: 'test',
        description: 'desc',
        targetRepo: 'o/r',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
      userId: 'U1',
      channelId: 'C123ABC',
      threadTs: '1234567890.123456',
    });

    expect(body).toContain('[Slack thread]');
    expect(body).toContain('https://slack.com/archives/C123ABC/p1234567890123456');
  });

  it('should omit Slack permalink from footer when channelId/threadTs are absent', () => {
    const body = buildIssueBody({
      request: {
        type: 'feature',
        title: 'test',
        description: 'desc',
        targetRepo: 'o/r',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
      userId: 'U1',
    });

    expect(body).not.toContain('[Slack thread]');
    expect(body).not.toContain('slack.com/archives');
  });
});

describe('buildSlackPermalink', () => {
  it('should remove the dot from threadTs and build the correct archive URL', () => {
    expect(buildSlackPermalink('C123ABC', '1234567890.123456')).toBe(
      'https://slack.com/archives/C123ABC/p1234567890123456',
    );
  });

  it('should handle threadTs without a dot', () => {
    expect(buildSlackPermalink('CXYZ', '9876543210')).toBe(
      'https://slack.com/archives/CXYZ/p9876543210',
    );
  });
});
