import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UnrecoverableError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent' },
}));

vi.mock('../services/state.service.js', () => ({
  savePipelineState: vi.fn(),
  getPipelineState: vi.fn(),
}));

vi.mock('../services/slack-notifier.service.js', () => ({
  notify: vi.fn(),
}));

vi.mock('../slack/blocks.js', () => ({
  buildPipelineProgressBlocks: vi
    .fn()
    .mockReturnValue([{ type: 'section', text: { type: 'mrkdwn', text: 'progress' } }]),
  buildPipelineCompletedBlocks: vi
    .fn()
    .mockReturnValue([{ type: 'section', text: { type: 'mrkdwn', text: 'completed' } }]),
  buildPipelineFailedBlocks: vi
    .fn()
    .mockReturnValue([{ type: 'section', text: { type: 'mrkdwn', text: 'failed' } }]),
  buildPipelineCancelledBlocks: vi
    .fn()
    .mockReturnValue([{ type: 'section', text: { type: 'mrkdwn', text: 'cancelled' } }]),
}));

vi.mock('./steps/create-issue.js', () => ({
  createIssueStep: vi.fn(),
}));

vi.mock('./steps/clone-repo.js', () => ({
  cloneRepoStep: vi.fn(),
}));

vi.mock('./steps/generate-code.js', () => ({
  generateCodeStep: vi.fn(),
}));

vi.mock('./steps/apply-and-push.js', () => ({
  applyAndPushStep: vi.fn(),
}));

vi.mock('./steps/create-pr.js', () => ({
  createPRStep: vi.fn(),
}));

import type { TaskJobData } from '../services/queue.service.js';
import { notify } from '../services/slack-notifier.service.js';
import { getPipelineState, savePipelineState } from '../services/state.service.js';
import {
  buildPipelineCancelledBlocks,
  buildPipelineCompletedBlocks,
  buildPipelineFailedBlocks,
  buildPipelineProgressBlocks,
} from '../slack/blocks.js';
import { runPipeline } from './orchestrator.js';
import { applyAndPushStep } from './steps/apply-and-push.js';
import { cloneRepoStep } from './steps/clone-repo.js';
import { createIssueStep } from './steps/create-issue.js';
import { createPRStep } from './steps/create-pr.js';
import { generateCodeStep } from './steps/generate-code.js';

const mockSavePipelineState = vi.mocked(savePipelineState);
const mockGetPipelineState = vi.mocked(getPipelineState);
const mockNotify = vi.mocked(notify);
const mockCreateIssueStep = vi.mocked(createIssueStep);
const mockCloneRepoStep = vi.mocked(cloneRepoStep);
const mockGenerateCodeStep = vi.mocked(generateCodeStep);
const mockApplyAndPushStep = vi.mocked(applyAndPushStep);
const mockCreatePRStep = vi.mocked(createPRStep);
const mockBuildProgressBlocks = vi.mocked(buildPipelineProgressBlocks);
const mockBuildCompletedBlocks = vi.mocked(buildPipelineCompletedBlocks);
const mockBuildFailedBlocks = vi.mocked(buildPipelineFailedBlocks);
const mockBuildCancelledBlocks = vi.mocked(buildPipelineCancelledBlocks);

function makeJobData(overrides?: Partial<TaskJobData>): TaskJobData {
  return {
    request: {
      type: 'feature',
      title: 'Test Feature',
      description: 'Test description',
      targetRepo: 'owner/repo',
      priority: 'medium',
      confidence: 0.9,
      missingInfo: null,
    },
    channelId: 'C123',
    threadTs: 'ts123',
    userId: 'U123',
    ...overrides,
  };
}

describe('orchestrator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // By default, getPipelineState returns null (not cancelled)
    mockGetPipelineState.mockResolvedValue(null);
    // Restore block builder mock return values after resetAllMocks
    mockBuildProgressBlocks.mockReturnValue([
      { type: 'section', text: { type: 'mrkdwn', text: 'progress' } },
    ]);
    mockBuildCompletedBlocks.mockReturnValue([
      { type: 'section', text: { type: 'mrkdwn', text: 'completed' } },
    ]);
    mockBuildFailedBlocks.mockReturnValue([
      { type: 'section', text: { type: 'mrkdwn', text: 'failed' } },
    ]);
    mockBuildCancelledBlocks.mockReturnValue([
      { type: 'section', text: { type: 'mrkdwn', text: 'cancelled' } },
    ]);
  });

  it('should throw UnrecoverableError when targetRepo is null', async () => {
    const data = makeJobData({
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

    await expect(runPipeline('job-1', data)).rejects.toThrow(UnrecoverableError);
  });

  it('should execute all 5 steps in order on success', async () => {
    const callOrder: string[] = [];
    mockCreateIssueStep.mockImplementation(async (ctx) => {
      callOrder.push('create_issue');
      ctx.issueNumber = 1;
      ctx.issueUrl = 'https://issue';
    });
    mockCloneRepoStep.mockImplementation(async (ctx) => {
      callOrder.push('clone_repo');
      ctx.branchName = 'codepilot/feature/test';
    });
    mockGenerateCodeStep.mockImplementation(async () => {
      callOrder.push('generate_code');
    });
    mockApplyAndPushStep.mockImplementation(async () => {
      callOrder.push('apply_and_push');
    });
    mockCreatePRStep.mockImplementation(async (ctx) => {
      callOrder.push('create_pr');
      ctx.prNumber = 10;
      ctx.prUrl = 'https://pr';
    });

    await runPipeline('job-1', makeJobData());

    expect(callOrder).toEqual([
      'create_issue',
      'clone_repo',
      'generate_code',
      'apply_and_push',
      'create_pr',
    ]);
  });

  it('should save pipeline state as completed on success', async () => {
    mockCreateIssueStep.mockImplementation(async (ctx) => {
      ctx.issueNumber = 1;
      ctx.issueUrl = 'https://issue';
    });
    mockCreatePRStep.mockImplementation(async (ctx) => {
      ctx.prNumber = 10;
      ctx.prUrl = 'https://pr';
    });

    await runPipeline('job-1', makeJobData());

    const lastCall = mockSavePipelineState.mock.calls.at(-1)?.[0];
    expect(lastCall?.status).toBe('completed');
    expect(lastCall?.issueNumber).toBe(1);
    expect(lastCall?.prNumber).toBe(10);
  });

  it('should save pipeline state as failed on error', async () => {
    mockCreateIssueStep.mockRejectedValue(new Error('GitHub API error'));

    await expect(runPipeline('job-1', makeJobData())).rejects.toThrow('GitHub API error');

    const lastSaveCall = mockSavePipelineState.mock.calls.at(-1)?.[0];
    expect(lastSaveCall?.status).toBe('failed');
    expect(lastSaveCall?.error).toBe('GitHub API error');
  });

  it('should send Slack notification with blocks on failure', async () => {
    mockCreateIssueStep.mockRejectedValue(new Error('something went wrong'));

    await expect(runPipeline('job-1', makeJobData())).rejects.toThrow();

    const failNotify = mockNotify.mock.calls.find((c) => c[2].includes('작업 실패'));
    expect(failNotify).toBeDefined();
    expect(failNotify?.[3]).toBeDefined();
    expect(mockBuildFailedBlocks).toHaveBeenCalled();
  });

  it('should send completion Slack notification with Block Kit on success', async () => {
    mockCreateIssueStep.mockImplementation(async (ctx) => {
      ctx.issueNumber = 5;
      ctx.issueUrl = 'https://issue/5';
    });
    mockCreatePRStep.mockImplementation(async (ctx) => {
      ctx.prNumber = 20;
      ctx.prUrl = 'https://pr/20';
    });

    await runPipeline('job-1', makeJobData());

    const successNotify = mockNotify.mock.calls.find((c) => c[2].includes('작업 완료'));
    expect(successNotify).toBeDefined();
    expect(successNotify?.[3]).toBeDefined();
    expect(mockBuildCompletedBlocks).toHaveBeenCalled();
  });

  it('should clean up workspace in finally block even on error', async () => {
    let tmpDir: string | undefined;
    mockCloneRepoStep.mockImplementation(async (ctx) => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepilot-orch-'));
      ctx.workspacePath = tmpDir;
    });
    mockGenerateCodeStep.mockRejectedValue(new Error('AI failed'));

    await expect(runPipeline('job-1', makeJobData())).rejects.toThrow('AI failed');

    // Wait for cleanup
    await new Promise((r) => setTimeout(r, 50));

    // Workspace should be cleaned up
    if (tmpDir) {
      await expect(fs.access(tmpDir)).rejects.toThrow();
    }
  });

  it('should update currentStep for each pipeline step', async () => {
    const stepSnapshots: string[] = [];
    mockSavePipelineState.mockImplementation(async (state) => {
      if (state.currentStep) {
        stepSnapshots.push(state.currentStep);
      }
    });

    await runPipeline('job-1', makeJobData());

    expect(stepSnapshots).toContain('create_issue');
    expect(stepSnapshots).toContain('clone_repo');
    expect(stepSnapshots).toContain('generate_code');
    expect(stepSnapshots).toContain('apply_and_push');
    expect(stepSnapshots).toContain('create_pr');
  });

  it('should send start notification', async () => {
    await runPipeline('job-1', makeJobData());

    const startNotify = mockNotify.mock.calls.find((c) => c[2].includes('작업을 시작'));
    expect(startNotify).toBeDefined();
  });

  it('should send Block Kit progress notifications for each step', async () => {
    await runPipeline('job-1', makeJobData());

    // buildPipelineProgressBlocks should have been called once per step (5 steps)
    expect(mockBuildProgressBlocks).toHaveBeenCalledTimes(5);
    // Each step notify call should include blocks (3rd index = blocks arg)
    const progressNotifyCalls = mockNotify.mock.calls.filter((c) => c[2].includes('진행 중'));
    expect(progressNotifyCalls).toHaveLength(5);
    for (const call of progressNotifyCalls) {
      expect(call[3]).toBeDefined();
    }
  });

  describe('cancellation', () => {
    it('should stop execution when pipeline is cancelled before a step', async () => {
      const callOrder: string[] = [];
      mockCreateIssueStep.mockImplementation(async () => {
        callOrder.push('create_issue');
      });

      // Return cancelled state before the second step (clone_repo)
      mockGetPipelineState
        .mockResolvedValueOnce(null) // before create_issue: not cancelled
        .mockResolvedValueOnce({
          id: 'job-1',
          threadTs: 'ts123',
          channelId: 'C123',
          request: makeJobData().request,
          status: 'cancelled',
          cancelledBy: 'U999',
          cancelledAt: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

      await runPipeline('job-1', makeJobData());

      // Only create_issue should have run, clone_repo should not
      expect(callOrder).toEqual(['create_issue']);
      expect(mockCloneRepoStep).not.toHaveBeenCalled();
      expect(mockGenerateCodeStep).not.toHaveBeenCalled();
      expect(mockApplyAndPushStep).not.toHaveBeenCalled();
      expect(mockCreatePRStep).not.toHaveBeenCalled();
    });

    it('should send cancellation notification with Block Kit blocks when cancelled', async () => {
      const cancelledState = {
        id: 'job-1',
        threadTs: 'ts123',
        channelId: 'C123',
        request: makeJobData().request,
        status: 'cancelled' as const,
        cancelledBy: 'U999',
        cancelledAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // Return cancelled immediately on first check (before create_issue)
      mockGetPipelineState.mockResolvedValue(cancelledState);

      await runPipeline('job-1', makeJobData());

      const cancelNotify = mockNotify.mock.calls.find((c) => c[2].includes('취소'));
      expect(cancelNotify).toBeDefined();
      expect(cancelNotify?.[3]).toBeDefined();
      expect(mockBuildCancelledBlocks).toHaveBeenCalledWith(cancelledState);
    });

    it('should not execute any steps when cancelled before first step', async () => {
      const cancelledState = {
        id: 'job-1',
        threadTs: 'ts123',
        channelId: 'C123',
        request: makeJobData().request,
        status: 'cancelled' as const,
        cancelledBy: 'U999',
        cancelledAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockGetPipelineState.mockResolvedValue(cancelledState);

      await runPipeline('job-1', makeJobData());

      expect(mockCreateIssueStep).not.toHaveBeenCalled();
      expect(mockCloneRepoStep).not.toHaveBeenCalled();
    });

    it('should clean up workspace when cancelled mid-pipeline', async () => {
      let tmpDir: string | undefined;
      mockCreateIssueStep.mockImplementation(async (ctx) => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepilot-cancel-'));
        ctx.workspacePath = tmpDir;
      });

      // Not cancelled before create_issue, cancelled before clone_repo
      mockGetPipelineState.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'job-1',
        threadTs: 'ts123',
        channelId: 'C123',
        request: makeJobData().request,
        status: 'cancelled' as const,
        cancelledBy: 'U999',
        cancelledAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await runPipeline('job-1', makeJobData());

      await new Promise((r) => setTimeout(r, 50));

      if (tmpDir) {
        await expect(fs.access(tmpDir)).rejects.toThrow();
      }
    });

    it('should not throw when cancellation occurs (return cleanly)', async () => {
      mockGetPipelineState.mockResolvedValue({
        id: 'job-1',
        threadTs: 'ts123',
        channelId: 'C123',
        request: makeJobData().request,
        status: 'cancelled' as const,
        cancelledBy: 'U999',
        cancelledAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await expect(runPipeline('job-1', makeJobData())).resolves.toBeUndefined();
    });
  });
});
