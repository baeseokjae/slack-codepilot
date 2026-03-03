import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent' },
}));

vi.mock('../../services/github.service.js', () => ({
  resolveRepo: vi.fn(),
  findExistingIssue: vi.fn(),
  createIssue: vi.fn(),
}));

vi.mock('../../services/slack-notifier.service.js', () => ({
  notify: vi.fn(),
}));

import { createIssue, findExistingIssue, resolveRepo } from '../../services/github.service.js';
import { notify } from '../../services/slack-notifier.service.js';
import type { PipelineContext } from '../types.js';
import { createIssueStep } from './create-issue.js';

const mockResolveRepo = vi.mocked(resolveRepo);
const mockFindExistingIssue = vi.mocked(findExistingIssue);
const mockCreateIssue = vi.mocked(createIssue);
const mockNotify = vi.mocked(notify);

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
    mockResolveRepo.mockResolvedValue({
      owner: 'owner',
      repo: 'repo',
      defaultBranch: 'main',
    });
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
    mockFindExistingIssue.mockResolvedValue(null);
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
    expect(mockNotify).toHaveBeenCalledOnce();
  });

  it('should reuse existing issue for idempotency', async () => {
    const ctx = makeCtx();
    mockFindExistingIssue.mockResolvedValue({
      number: 10,
      url: 'https://github.com/owner/repo/issues/10',
    });

    await createIssueStep(ctx);

    expect(ctx.issueNumber).toBe(10);
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it('should set repoInfo on context', async () => {
    const ctx = makeCtx();
    mockFindExistingIssue.mockResolvedValue(null);
    mockCreateIssue.mockResolvedValue({ number: 1, url: 'https://example.com' });

    await createIssueStep(ctx);

    expect(ctx.repoInfo).toEqual({ owner: 'owner', repo: 'repo', defaultBranch: 'main' });
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
    mockFindExistingIssue.mockResolvedValue(null);
    mockCreateIssue.mockResolvedValue({ number: 1, url: 'https://example.com' });

    await createIssueStep(ctx);

    expect(mockCreateIssue.mock.calls[0][0].labels).toContain('bug');
  });
});
