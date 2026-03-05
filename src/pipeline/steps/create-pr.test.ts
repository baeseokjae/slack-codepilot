import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent', GITHUB_REVIEW_TEAM: undefined },
}));

vi.mock('../../services/github.service.js', () => ({
  createPullRequest: vi.fn(),
  findExistingPR: vi.fn(),
  addAssignees: vi.fn(),
  requestReviewers: vi.fn(),
}));

import { config } from '../../config/index.js';
import { addAssignees, createPullRequest, findExistingPR, requestReviewers } from '../../services/github.service.js';
import type { PipelineContext } from '../types.js';
import { createPRStep } from './create-pr.js';

const mockFindExistingPR = vi.mocked(findExistingPR);
const mockCreatePullRequest = vi.mocked(createPullRequest);
const mockAddAssignees = vi.mocked(addAssignees);
const mockRequestReviewers = vi.mocked(requestReviewers);

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    jobId: 'job-1',
    correlationId: 'test-correlation-id',
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
    Object.assign(config, { GITHUB_REVIEW_TEAM: undefined });
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

  it('should assign PR to the Slack requester when githubUsername is set', async () => {
    const ctx = makeCtx({ githubUsername: 'github-dev' });
    mockFindExistingPR.mockResolvedValue(null);
    mockCreatePullRequest.mockResolvedValue({ number: 99, url: 'https://github.com/owner/repo/pull/99' });

    await createPRStep(ctx);

    expect(mockAddAssignees).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issueNumber: 99,
      assignees: ['github-dev'],
    });
  });

  it('should not add assignees when githubUsername is not set', async () => {
    const ctx = makeCtx();
    mockFindExistingPR.mockResolvedValue(null);
    mockCreatePullRequest.mockResolvedValue({ number: 99, url: 'https://github.com/owner/repo/pull/99' });

    await createPRStep(ctx);

    expect(mockAddAssignees).not.toHaveBeenCalled();
  });

  it('should not fail PR creation when assignee request fails', async () => {
    const ctx = makeCtx({ githubUsername: 'github-dev' });
    mockFindExistingPR.mockResolvedValue(null);
    mockCreatePullRequest.mockResolvedValue({ number: 99, url: 'https://github.com/owner/repo/pull/99' });
    mockAddAssignees.mockRejectedValue(new Error('Not a collaborator'));

    await createPRStep(ctx);

    expect(ctx.prNumber).toBe(99);
  });

  it('should request team reviewers when GITHUB_REVIEW_TEAM is set', async () => {
    Object.assign(config, { GITHUB_REVIEW_TEAM: 'backend-team' });
    const ctx = makeCtx();
    mockFindExistingPR.mockResolvedValue(null);
    mockCreatePullRequest.mockResolvedValue({ number: 99, url: 'https://github.com/owner/repo/pull/99' });

    await createPRStep(ctx);

    expect(mockRequestReviewers).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pullNumber: 99,
      teamReviewers: ['backend-team'],
    });
  });

  it('should not request reviewers when GITHUB_REVIEW_TEAM is not set', async () => {
    const ctx = makeCtx();
    mockFindExistingPR.mockResolvedValue(null);
    mockCreatePullRequest.mockResolvedValue({ number: 99, url: 'https://github.com/owner/repo/pull/99' });

    await createPRStep(ctx);

    expect(mockRequestReviewers).not.toHaveBeenCalled();
  });

  it('should not fail PR creation when team reviewer request fails', async () => {
    Object.assign(config, { GITHUB_REVIEW_TEAM: 'nonexistent-team' });
    const ctx = makeCtx();
    mockFindExistingPR.mockResolvedValue(null);
    mockCreatePullRequest.mockResolvedValue({ number: 99, url: 'https://github.com/owner/repo/pull/99' });
    mockRequestReviewers.mockRejectedValue(new Error('Team not found'));

    await createPRStep(ctx);

    // PR 생성은 성공해야 함
    expect(ctx.prNumber).toBe(99);
  });
});
