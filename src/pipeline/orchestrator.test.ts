import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UnrecoverableError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerInstance = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../lib/logger.js', () => ({
  createLogger: vi.fn(),
}));

vi.mock('../lib/metrics.js', () => ({
  pipelineTotal: { inc: vi.fn() },
  pipelineDuration: { observe: vi.fn() },
  pipelineStepDuration: { observe: vi.fn() },
}));

vi.mock('../services/state.service.js', () => ({
  savePipelineState: vi.fn(),
  getPipelineState: vi.fn(),
}));

vi.mock('../services/slack-notifier.service.js', () => ({
  notify: vi.fn(),
  updateNotification: vi.fn(),
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

vi.mock('./steps/create-notion-issue.js', () => ({
  createNotionIssueStep: vi.fn(),
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

import { createLogger } from '../lib/logger.js';
import { pipelineDuration, pipelineStepDuration, pipelineTotal } from '../lib/metrics.js';
import type { TaskJobData } from '../services/queue.service.js';
import { notify, updateNotification } from '../services/slack-notifier.service.js';
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
import { createNotionIssueStep } from './steps/create-notion-issue.js';
import { createPRStep } from './steps/create-pr.js';
import { generateCodeStep } from './steps/generate-code.js';

const mockSavePipelineState = vi.mocked(savePipelineState);
const mockGetPipelineState = vi.mocked(getPipelineState);
const mockNotify = vi.mocked(notify);
const mockUpdateNotification = vi.mocked(updateNotification);
const mockCreateNotionIssueStep = vi.mocked(createNotionIssueStep);
const mockCreateIssueStep = vi.mocked(createIssueStep);
const mockCloneRepoStep = vi.mocked(cloneRepoStep);
const mockGenerateCodeStep = vi.mocked(generateCodeStep);
const mockApplyAndPushStep = vi.mocked(applyAndPushStep);
const mockCreatePRStep = vi.mocked(createPRStep);
const mockBuildProgressBlocks = vi.mocked(buildPipelineProgressBlocks);
const mockBuildCompletedBlocks = vi.mocked(buildPipelineCompletedBlocks);
const mockBuildFailedBlocks = vi.mocked(buildPipelineFailedBlocks);
const mockBuildCancelledBlocks = vi.mocked(buildPipelineCancelledBlocks);
const mockPipelineTotal = vi.mocked(pipelineTotal);
const mockPipelineDuration = vi.mocked(pipelineDuration);
const mockPipelineStepDuration = vi.mocked(pipelineStepDuration);
const mockCreateLogger = vi.mocked(createLogger);

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
    // Restore createLogger mock implementation after resetAllMocks
    mockCreateLogger.mockReturnValue(
      mockLoggerInstance as unknown as ReturnType<typeof createLogger>,
    );
    // By default, getPipelineState returns null (not cancelled)
    mockGetPipelineState.mockResolvedValue(null);
    // notify returns a message ts for progress tracking
    mockNotify.mockResolvedValue('progress-ts-123');
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

  it('should pass conversationHistory to pipeline context', async () => {
    const history = [
      { role: 'user' as const, content: 'README 업데이트해줘', timestamp: 'ts1' },
      { role: 'assistant' as const, content: '어떤 내용을 업데이트할까요?', timestamp: 'ts2' },
      { role: 'user' as const, content: '설치 방법 추가', timestamp: 'ts3' },
    ];
    const data = makeJobData({ conversationHistory: history });

    mockCreateIssueStep.mockImplementation(async (ctx) => {
      expect(ctx.conversationHistory).toEqual(history);
    });

    await runPipeline('job-1', data);

    expect(mockCreateIssueStep).toHaveBeenCalledOnce();
  });

  it('should work without conversationHistory (backward compat)', async () => {
    const data = makeJobData();
    // No conversationHistory field

    mockCreateIssueStep.mockImplementation(async (ctx) => {
      expect(ctx.conversationHistory).toBeUndefined();
    });

    await runPipeline('job-1', data);

    expect(mockCreateIssueStep).toHaveBeenCalledOnce();
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

  it('should execute all 6 steps in order on success', async () => {
    const callOrder: string[] = [];
    mockCreateNotionIssueStep.mockImplementation(async () => {
      callOrder.push('create_notion_issue');
    });
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
      'create_notion_issue',
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

  it('should update progress message with failure blocks on error', async () => {
    mockCreateIssueStep.mockRejectedValue(new Error('something went wrong'));

    await expect(runPipeline('job-1', makeJobData())).rejects.toThrow();

    // First step sends notify (creates progress message), failure updates same message
    const failUpdate = mockUpdateNotification.mock.calls.find((c) => c[2].includes('작업 실패'));
    expect(failUpdate).toBeDefined();
    expect(failUpdate?.[1]).toBe('progress-ts-123');
    expect(failUpdate?.[3]).toBeDefined();
    expect(mockBuildFailedBlocks).toHaveBeenCalled();
  });

  it('should update progress message with completion blocks on success', async () => {
    mockCreateIssueStep.mockImplementation(async (ctx) => {
      ctx.issueNumber = 5;
      ctx.issueUrl = 'https://issue/5';
    });
    mockCreatePRStep.mockImplementation(async (ctx) => {
      ctx.prNumber = 20;
      ctx.prUrl = 'https://pr/20';
    });

    await runPipeline('job-1', makeJobData());

    const successUpdate = mockUpdateNotification.mock.calls.find((c) => c[2].includes('작업 완료'));
    expect(successUpdate).toBeDefined();
    expect(successUpdate?.[1]).toBe('progress-ts-123');
    expect(successUpdate?.[3]).toBeDefined();
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

    expect(stepSnapshots).toContain('create_notion_issue');
    expect(stepSnapshots).toContain('create_issue');
    expect(stepSnapshots).toContain('clone_repo');
    expect(stepSnapshots).toContain('generate_code');
    expect(stepSnapshots).toContain('apply_and_push');
    expect(stepSnapshots).toContain('create_pr');
  });

  it('should send first progress as new message and update subsequent steps', async () => {
    await runPipeline('job-1', makeJobData());

    // buildPipelineProgressBlocks should have been called once per step (6 steps)
    expect(mockBuildProgressBlocks).toHaveBeenCalledTimes(6);

    // First step: notify (new message)
    const firstProgressCall = mockNotify.mock.calls.find((c) => c[2].includes('진행 중'));
    expect(firstProgressCall).toBeDefined();

    // 5 progress updates + 1 completion update = 6 total
    expect(mockUpdateNotification).toHaveBeenCalledTimes(6);
    for (const call of mockUpdateNotification.mock.calls.filter((c) => c[2].includes('진행 중'))) {
      expect(call[0]).toBe('C123');
      expect(call[1]).toBe('progress-ts-123');
      expect(call[3]).toBeDefined(); // blocks
    }
  });

  describe('observability', () => {
    it('should call pipelineTotal.inc with status completed on success', async () => {
      await runPipeline('job-1', makeJobData());

      expect(mockPipelineTotal.inc).toHaveBeenCalledWith({ status: 'completed' });
    });

    it('should call pipelineTotal.inc with status failed on error', async () => {
      mockCreateIssueStep.mockRejectedValue(new Error('step error'));

      await expect(runPipeline('job-1', makeJobData())).rejects.toThrow('step error');

      expect(mockPipelineTotal.inc).toHaveBeenCalledWith({ status: 'failed' });
    });

    it('should call pipelineStepDuration.observe for each completed step', async () => {
      await runPipeline('job-1', makeJobData());

      expect(mockPipelineStepDuration.observe).toHaveBeenCalledTimes(6);
      expect(mockPipelineStepDuration.observe).toHaveBeenCalledWith(
        { step: 'create_notion_issue' },
        expect.any(Number),
      );
      expect(mockPipelineStepDuration.observe).toHaveBeenCalledWith(
        { step: 'create_issue' },
        expect.any(Number),
      );
      expect(mockPipelineStepDuration.observe).toHaveBeenCalledWith(
        { step: 'clone_repo' },
        expect.any(Number),
      );
      expect(mockPipelineStepDuration.observe).toHaveBeenCalledWith(
        { step: 'generate_code' },
        expect.any(Number),
      );
      expect(mockPipelineStepDuration.observe).toHaveBeenCalledWith(
        { step: 'apply_and_push' },
        expect.any(Number),
      );
      expect(mockPipelineStepDuration.observe).toHaveBeenCalledWith(
        { step: 'create_pr' },
        expect.any(Number),
      );
    });

    it('should call pipelineDuration.observe on success', async () => {
      await runPipeline('job-1', makeJobData());

      expect(mockPipelineDuration.observe).toHaveBeenCalledWith(expect.any(Number));
    });

    it('should call pipelineDuration.observe on failure', async () => {
      mockCreateIssueStep.mockRejectedValue(new Error('step error'));

      await expect(runPipeline('job-1', makeJobData())).rejects.toThrow('step error');

      expect(mockPipelineDuration.observe).toHaveBeenCalledWith(expect.any(Number));
    });

    it('should call pipelineTotal.inc with status cancelled on cancellation', async () => {
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

      await runPipeline('job-1', makeJobData());

      expect(mockPipelineTotal.inc).toHaveBeenCalledWith({ status: 'cancelled' });
    });

    it('should save stepTimings in state on success', async () => {
      await runPipeline('job-1', makeJobData());

      const lastCall = mockSavePipelineState.mock.calls.at(-1)?.[0];
      expect(lastCall?.stepTimings).toBeDefined();
      expect(lastCall?.stepTimings).toHaveProperty('create_notion_issue');
      expect(lastCall?.stepTimings).toHaveProperty('create_issue');
      expect(lastCall?.stepTimings).toHaveProperty('clone_repo');
      expect(lastCall?.stepTimings).toHaveProperty('generate_code');
      expect(lastCall?.stepTimings).toHaveProperty('apply_and_push');
      expect(lastCall?.stepTimings).toHaveProperty('create_pr');
    });
  });

  describe('cancellation', () => {
    it('should stop execution when pipeline is cancelled before a step', async () => {
      const callOrder: string[] = [];
      mockCreateNotionIssueStep.mockImplementation(async () => {
        callOrder.push('create_notion_issue');
      });
      mockCreateIssueStep.mockImplementation(async () => {
        callOrder.push('create_issue');
      });

      // Return cancelled state before the third step (clone_repo)
      mockGetPipelineState
        .mockResolvedValueOnce(null) // before create_notion_issue: not cancelled
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

      // Only create_notion_issue and create_issue should have run
      expect(callOrder).toEqual(['create_notion_issue', 'create_issue']);
      expect(mockCloneRepoStep).not.toHaveBeenCalled();
      expect(mockGenerateCodeStep).not.toHaveBeenCalled();
      expect(mockApplyAndPushStep).not.toHaveBeenCalled();
      expect(mockCreatePRStep).not.toHaveBeenCalled();
    });

    it('should send cancellation notification when cancelled before first step (no progressTs)', async () => {
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

      // No progressTs yet, so should use notify (new message)
      const cancelNotify = mockNotify.mock.calls.find((c) => c[2].includes('취소'));
      expect(cancelNotify).toBeDefined();
      expect(cancelNotify?.[3]).toBeDefined();
      expect(mockBuildCancelledBlocks).toHaveBeenCalledWith(cancelledState);
    });

    it('should update progress message when cancelled mid-pipeline', async () => {
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

      mockGetPipelineState
        .mockResolvedValueOnce(null) // before create_notion_issue: not cancelled
        .mockResolvedValue(cancelledState); // before create_issue: cancelled

      await runPipeline('job-1', makeJobData());

      // progressTs exists from first step, so should use updateNotification
      const cancelUpdate = mockUpdateNotification.mock.calls.find((c) => c[2].includes('취소'));
      expect(cancelUpdate).toBeDefined();
      expect(cancelUpdate?.[1]).toBe('progress-ts-123');
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

      expect(mockCreateNotionIssueStep).not.toHaveBeenCalled();
      expect(mockCreateIssueStep).not.toHaveBeenCalled();
      expect(mockCloneRepoStep).not.toHaveBeenCalled();
    });

    it('should clean up workspace when cancelled mid-pipeline', async () => {
      let tmpDir: string | undefined;
      mockCreateNotionIssueStep.mockImplementation(async (ctx) => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepilot-cancel-'));
        ctx.workspacePath = tmpDir;
      });

      // Not cancelled before create_notion_issue, cancelled before create_issue
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
