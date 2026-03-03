import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { UnrecoverableError } from 'bullmq';
import { sanitizeErrorObject } from '../lib/error-sanitizer.js';
import { createLogger } from '../lib/logger.js';
import { pipelineDuration, pipelineStepDuration, pipelineTotal } from '../lib/metrics.js';
import type { TaskJobData } from '../services/queue.service.js';
import { notify } from '../services/slack-notifier.service.js';
import { getPipelineState, savePipelineState } from '../services/state.service.js';
import {
  buildPipelineCancelledBlocks,
  buildPipelineCompletedBlocks,
  buildPipelineFailedBlocks,
  buildPipelineProgressBlocks,
} from '../slack/blocks.js';
import type { PipelineState, PipelineStep } from '../types/index.js';
import { applyAndPushStep } from './steps/apply-and-push.js';
import { cloneRepoStep } from './steps/clone-repo.js';
import { createIssueStep } from './steps/create-issue.js';
import { createPRStep } from './steps/create-pr.js';
import { generateCodeStep } from './steps/generate-code.js';
import type { PipelineContext } from './types.js';

const STEPS: { name: PipelineStep; handler: (ctx: PipelineContext) => Promise<void> }[] = [
  { name: 'create_issue', handler: createIssueStep },
  { name: 'clone_repo', handler: cloneRepoStep },
  { name: 'generate_code', handler: generateCodeStep },
  { name: 'apply_and_push', handler: applyAndPushStep },
  { name: 'create_pr', handler: createPRStep },
];

export async function runPipeline(jobId: string, data: TaskJobData): Promise<void> {
  const { request, channelId, threadTs, userId } = data;

  if (!request.targetRepo) {
    throw new UnrecoverableError('targetRepo is null — cannot proceed without a target repository');
  }

  const correlationId = randomUUID();
  const log = createLogger('orchestrator', correlationId);

  const ctx: PipelineContext = {
    jobId,
    correlationId,
    channelId,
    threadTs,
    userId,
    request,
  };

  const state: PipelineState = {
    id: jobId,
    threadTs,
    channelId,
    request,
    status: 'in_progress',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const stepTimings: Record<string, number> = {};
  const pipelineStartTime = Date.now();

  await savePipelineState(state);
  await notify(channelId, threadTs, ':gear: 작업을 시작합니다...');

  try {
    for (const step of STEPS) {
      // Cooperative cancellation: check if pipeline was cancelled before each step
      const latestState = await getPipelineState(jobId);
      if (latestState?.status === 'cancelled') {
        log.info({ jobId }, 'Pipeline cancelled, stopping execution');
        await notify(
          channelId,
          threadTs,
          '작업이 취소되었습니다.',
          buildPipelineCancelledBlocks(latestState),
        );
        pipelineTotal.inc({ status: 'cancelled' });
        return; // finally block will run workspace cleanup
      }

      state.currentStep = step.name;
      state.updatedAt = Date.now();
      await savePipelineState(state);

      // Block Kit progress notification
      await notify(
        channelId,
        threadTs,
        `${step.name} 진행 중...`,
        buildPipelineProgressBlocks(state),
      );

      log.info({ jobId, step: step.name }, 'Executing pipeline step');
      const stepStart = Date.now();
      await step.handler(ctx);
      const stepDurationMs = Date.now() - stepStart;
      stepTimings[step.name] = stepDurationMs;
      pipelineStepDuration.observe({ step: step.name }, stepDurationMs / 1000);
      log.info({ jobId, step: step.name, durationMs: stepDurationMs }, 'Pipeline step completed');
    }

    state.status = 'completed';
    state.issueNumber = ctx.issueNumber;
    state.issueUrl = ctx.issueUrl;
    state.branchName = ctx.branchName;
    state.prNumber = ctx.prNumber;
    state.prUrl = ctx.prUrl;
    state.updatedAt = Date.now();
    state.stepTimings = stepTimings;
    await savePipelineState(state);

    const totalDurationMs = Date.now() - pipelineStartTime;
    pipelineDuration.observe(totalDurationMs / 1000);
    pipelineTotal.inc({ status: 'completed' });

    await notify(channelId, threadTs, '작업 완료!', buildPipelineCompletedBlocks(state));
  } catch (err) {
    state.status = 'failed';
    state.error = sanitizeErrorObject(err);
    state.updatedAt = Date.now();
    state.stepTimings = stepTimings;
    await savePipelineState(state);

    const totalDurationMs = Date.now() - pipelineStartTime;
    pipelineDuration.observe(totalDurationMs / 1000);
    pipelineTotal.inc({ status: 'failed' });

    await notify(
      channelId,
      threadTs,
      `작업 실패: ${state.error}`,
      buildPipelineFailedBlocks(state),
    );

    throw err;
  } finally {
    if (ctx.workspacePath) {
      try {
        await fs.rm(ctx.workspacePath, { recursive: true, force: true });
        log.info({ workspacePath: ctx.workspacePath }, 'Workspace cleaned up');
      } catch (cleanupErr) {
        log.warn(
          { err: cleanupErr, workspacePath: ctx.workspacePath },
          'Failed to clean up workspace',
        );
      }
    }
  }
}
