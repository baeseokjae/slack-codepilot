import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent' },
}));

vi.mock('../../services/github.service.js', () => ({
  createPullRequest: vi.fn(),
  findExistingPR: vi.fn(),
}));

vi.mock('../../services/slack-notifier.service.js', () => ({
  notify: vi.fn(),
}));

import { createPullRequest, findExistingPR } from '../../services/github.service.js';
import { notify } from '../../services/slack-notifier.service.js';
import type { PipelineContext } from '../types.js';
import { createPRStep } from './create-pr.js';

const mockFindExistingPR = vi.mocked(findExistingPR);
const mockCreatePullRequest = vi.mocked(createPullRequest);
const mockNotify = vi.mocked(notify);

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    jobId: 'job-1',
    channelId: 'C123',
    threadTs: 'ts123',
    userId: 'U123',
    request: {
      type: 'feature',
      title: '새 기능',
      description: '새 기능 설명',
      targetRepo: 'owner/repo',
      priority: 'medium',
      confidence: 0.9,
      missingInfo: null,
    },
    repoInfo: { owner: 'owner', repo: 'repo', defaultBranch: 'main' },
    branchName: 'codepilot/feature/test',
    issueNumber: 42,
    codeChanges: [{ filePath: 'src/new.ts', content: 'test', action: 'create' as const }],
    ...overrides,
  };
}

describe('createPRStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw when repoInfo is missing', async () => {
    const ctx = makeCtx({ repoInfo: undefined });
    await expect(createPRStep(ctx)).rejects.toThrow('required');
  });

  it('should throw when branchName is missing', async () => {
    const ctx = makeCtx({ branchName: undefined });
    await expect(createPRStep(ctx)).rejects.toThrow('required');
  });

  it('should throw when issueNumber is missing', async () => {
    const ctx = makeCtx({ issueNumber: undefined });
    await expect(createPRStep(ctx)).rejects.toThrow('required');
  });

  it('should create a new PR when none exists', async () => {
    const ctx = makeCtx();
    mockFindExistingPR.mockResolvedValue(null);
    mockCreatePullRequest.mockResolvedValue({
      number: 99,
      url: 'https://github.com/owner/repo/pull/99',
    });

    await createPRStep(ctx);

    expect(ctx.prNumber).toBe(99);
    expect(ctx.prUrl).toBe('https://github.com/owner/repo/pull/99');
    expect(mockCreatePullRequest).toHaveBeenCalledOnce();
    expect(mockCreatePullRequest.mock.calls[0][0].title).toBe('[CodePilot] 새 기능');
    expect(mockCreatePullRequest.mock.calls[0][0].body).toContain('Closes #42');
    expect(mockCreatePullRequest.mock.calls[0][0].head).toBe('codepilot/feature/test');
    expect(mockCreatePullRequest.mock.calls[0][0].base).toBe('main');
  });

  it('should reuse existing PR for idempotency', async () => {
    const ctx = makeCtx();
    mockFindExistingPR.mockResolvedValue({
      number: 50,
      url: 'https://github.com/owner/repo/pull/50',
    });

    await createPRStep(ctx);

    expect(ctx.prNumber).toBe(50);
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  it('should send Slack notification after PR creation', async () => {
    const ctx = makeCtx();
    mockFindExistingPR.mockResolvedValue(null);
    mockCreatePullRequest.mockResolvedValue({
      number: 77,
      url: 'https://github.com/owner/repo/pull/77',
    });

    await createPRStep(ctx);

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify.mock.calls[0][2]).toContain('PR #77');
  });

  it('should include changes summary in PR body', async () => {
    const ctx = makeCtx({
      codeChanges: [
        { filePath: 'src/a.ts', content: 'a', action: 'create' as const },
        { filePath: 'src/b.ts', content: 'b', action: 'update' as const },
      ],
    });
    mockFindExistingPR.mockResolvedValue(null);
    mockCreatePullRequest.mockResolvedValue({ number: 1, url: 'https://example.com' });

    await createPRStep(ctx);

    const body = mockCreatePullRequest.mock.calls[0][0].body;
    expect(body).toContain('src/a.ts');
    expect(body).toContain('src/b.ts');
    expect(body).toContain('create');
    expect(body).toContain('update');
  });
});
