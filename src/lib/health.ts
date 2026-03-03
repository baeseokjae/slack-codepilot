import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export interface ServiceHealth {
  status: 'ok' | 'error';
  latencyMs?: number;
  error?: string;
  waiting?: number;
  active?: number;
  failed?: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  services: {
    redis: ServiceHealth;
    bullmq: ServiceHealth;
  };
}

export async function checkRedisHealth(redis: Redis): Promise<ServiceHealth> {
  try {
    const start = Date.now();
    await redis.ping();
    const latencyMs = Date.now() - start;
    return { status: 'ok', latencyMs };
  } catch (err) {
    return { status: 'error', error: (err as Error).message };
  }
}

export async function checkBullMQHealth(queueName: string, redis: Redis): Promise<ServiceHealth> {
  // @ts-expect-error ioredis version mismatch between project and bullmq's bundled ioredis
  const queue = new Queue(queueName, { connection: redis });
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'failed');
    return {
      status: 'ok',
      waiting: counts.waiting,
      active: counts.active,
      failed: counts.failed,
    };
  } catch (err) {
    return { status: 'error', error: (err as Error).message };
  } finally {
    await queue.close();
  }
}

export function deriveOverallStatus(
  services: HealthStatus['services'],
): 'healthy' | 'degraded' | 'unhealthy' {
  if (services.redis.status === 'error') {
    return 'unhealthy';
  }
  if (services.bullmq.status === 'error') {
    return 'degraded';
  }
  return 'healthy';
}
