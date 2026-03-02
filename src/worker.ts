import { UnrecoverableError, Worker } from 'bullmq';
import pino from 'pino';
import { config } from './config/index.js';
import { runPipeline } from './pipeline/orchestrator.js';
import { validateGitHubConfig } from './services/github.service.js';
import type { TaskJobData } from './services/queue.service.js';

const logger = pino({ name: 'worker', level: config.LOG_LEVEL });

const QUEUE_NAME = 'codepilot-tasks';

function parseRedisUrl(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: Number.parseInt(parsed.port, 10) || 6379,
  };
}

validateGitHubConfig();

const worker = new Worker<TaskJobData>(
  QUEUE_NAME,
  async (job) => {
    logger.info({ jobId: job.id, title: job.data.request.title }, 'Processing job');
    await runPipeline(job.id ?? 'unknown', job.data);
    logger.info({ jobId: job.id }, 'Job completed successfully');
  },
  {
    connection: parseRedisUrl(config.REDIS_URL),
    concurrency: 1,
  },
);

worker.on('failed', (job, err) => {
  if (err instanceof UnrecoverableError) {
    logger.error({ jobId: job?.id, err: err.message }, 'Job failed permanently (unrecoverable)');
  } else {
    logger.warn(
      { jobId: job?.id, err: err.message, attemptsMade: job?.attemptsMade },
      'Job failed, may retry',
    );
  }
});

worker.on('error', (err) => {
  logger.error({ err }, 'Worker error');
});

logger.info('Worker started, listening for jobs on queue: %s', QUEUE_NAME);

async function shutdown(): Promise<void> {
  logger.info('Worker shutting down...');
  await worker.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
