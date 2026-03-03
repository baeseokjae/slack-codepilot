import { Redis } from 'ioredis';
import pino from 'pino';
import { config } from '../config/index.js';
import type { TaskJobData } from '../services/queue.service.js';
import type { PipelineState, ThreadContext } from '../types/index.js';

const logger = pino({ name: 'state-service', level: config.LOG_LEVEL });
const THREAD_TTL = 3600; // 1 hour
const PENDING_TTL = 1800; // 30 minutes

let redis: Redis;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.REDIS_URL);
    redis.on('error', (err: Error) => logger.error({ err }, 'Redis connection error'));
    redis.on('connect', () => logger.info('Connected to Redis'));
  }
  return redis;
}

function threadKey(channelId: string, threadTs: string): string {
  return `thread:${channelId}:${threadTs}`;
}

function pipelineKey(id: string): string {
  return `pipeline:${id}`;
}

function pendingKey(id: string): string {
  return `pending:${id}`;
}

export async function saveThreadContext(ctx: ThreadContext): Promise<void> {
  const r = getRedis();
  const key = threadKey(ctx.channelId, ctx.threadTs);
  await r.set(key, JSON.stringify(ctx), 'EX', THREAD_TTL);
  logger.debug({ key }, 'Saved thread context');
}

export async function getThreadContext(
  channelId: string,
  threadTs: string,
): Promise<ThreadContext | null> {
  const r = getRedis();
  const key = threadKey(channelId, threadTs);
  const data = await r.get(key);
  if (!data) return null;
  return JSON.parse(data) as ThreadContext;
}

export async function deleteThreadContext(channelId: string, threadTs: string): Promise<void> {
  const r = getRedis();
  const key = threadKey(channelId, threadTs);
  await r.del(key);
}

// Phase 2 interfaces
export async function savePipelineState(state: PipelineState): Promise<void> {
  const r = getRedis();
  const key = pipelineKey(state.id);
  await r.set(key, JSON.stringify(state));
  // Index in Sorted Set (score = createdAt)
  await r.zadd('pipeline:index', state.createdAt, state.id);
  logger.debug({ key }, 'Saved pipeline state');
}

export async function getPipelineState(id: string): Promise<PipelineState | null> {
  const r = getRedis();
  const key = pipelineKey(id);
  const data = await r.get(key);
  if (!data) return null;
  return JSON.parse(data) as PipelineState;
}

// Phase 3: Pending confirmation management

export async function savePendingConfirmation(id: string, data: TaskJobData): Promise<void> {
  const r = getRedis();
  const key = pendingKey(id);
  await r.set(key, JSON.stringify(data), 'EX', PENDING_TTL);
  logger.debug({ key }, 'Saved pending confirmation');
}

export async function getPendingConfirmation(id: string): Promise<TaskJobData | null> {
  const r = getRedis();
  const key = pendingKey(id);
  const data = await r.get(key);
  if (!data) return null;
  return JSON.parse(data) as TaskJobData;
}

export async function deletePendingConfirmation(id: string): Promise<void> {
  const r = getRedis();
  const key = pendingKey(id);
  await r.del(key);
}

// Phase 3: Recent pipeline list

export async function listRecentPipelines(limit = 10): Promise<PipelineState[]> {
  const r = getRedis();
  const ids = await r.zrevrange('pipeline:index', 0, limit - 1);
  const states = await Promise.all(ids.map((id) => getPipelineState(id)));
  return states.filter((s): s is PipelineState => s !== null);
}

export function closeRedis(): void {
  if (redis) {
    redis.disconnect();
  }
}
