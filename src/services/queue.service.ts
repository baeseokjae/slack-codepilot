import { type Job, Queue, UnrecoverableError } from 'bullmq';
import { config } from '../config/index.js';
import { createLogger } from '../lib/logger.js';
import type { ConversationMessage, ParsedRequest } from '../types/index.js';

const logger = createLogger('queue-service');

export interface TaskJobData {
  request: ParsedRequest;
  conversationHistory?: ConversationMessage[];
  channelId: string;
  threadTs: string;
  userId: string;
}

// Phase 2: SQS 교체 대비 추상 인터페이스
export interface QueueService {
  enqueue(data: TaskJobData): Promise<string>;
  close(): Promise<void>;
}

// --- BullMQ 구현 ---

export const QUEUE_NAME = 'codepilot-tasks';

let queue: Queue;

function parseRedisUrl(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port, 10) || 6379,
  };
}

export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: parseRedisUrl(config.REDIS_URL),
    });
    logger.info('BullMQ queue initialized');
  }
  return queue;
}

class BullMQQueueService implements QueueService {
  async enqueue(data: TaskJobData): Promise<string> {
    const q = getQueue();
    const job = await q.add('process-request', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    logger.info({ jobId: job.id, title: data.request.title }, 'Task enqueued');
    return job.id ?? 'unknown';
  }

  async close(): Promise<void> {
    if (queue) {
      await queue.close();
    }
  }
}

const queueService: QueueService = new BullMQQueueService();

// 하위 호환 함수 export (기존 호출 코드 유지)
export const enqueueTask = (data: TaskJobData) => queueService.enqueue(data);
export const closeQueue = () => queueService.close();
export { queueService };

export async function getJob(jobId: string): Promise<Job<TaskJobData> | undefined> {
  const q = getQueue();
  const job = await q.getJob(jobId);
  return job ?? undefined;
}

export async function cancelJob(jobId: string, reason: string): Promise<boolean> {
  const q = getQueue();
  const job = await q.getJob(jobId);
  if (!job) return false;

  const state = await job.getState();
  if (state === 'completed' || state === 'failed') return false;

  if (state === 'waiting' || state === 'delayed') {
    await job.remove();
    logger.info({ jobId }, 'Job removed from queue');
    return true;
  }

  // active 상태: UnrecoverableError로 재시도 방지
  await job.moveToFailed(new UnrecoverableError(reason), job.token ?? '0', true);
  logger.info({ jobId, reason }, 'Active job cancelled (no retry)');
  return true;
}
