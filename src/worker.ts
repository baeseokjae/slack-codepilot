import fs from 'node:fs';
import { UnrecoverableError, Worker } from 'bullmq';
import { config } from './config/index.js';
import { createLogger } from './lib/logger.js';
import { runPipeline } from './pipeline/orchestrator.js';
import { validateGitHubConfig } from './services/github.service.js';
import type { TaskJobData } from './services/queue.service.js';
import { closeRedis } from './services/state.service.js';

const logger = createLogger('worker');

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

// File-based health check for Docker
const HEALTH_FILE = '/tmp/worker-health';
const healthInterval = setInterval(() => {
  try {
    fs.writeFileSync(HEALTH_FILE, new Date().toISOString());
  } catch {
    // Ignore write errors
  }
}, 10000);

// Write initial health file
try {
  fs.writeFileSync(HEALTH_FILE, new Date().toISOString());
} catch {
  // Ignore
}

let isShuttingDown = false;

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info('Worker shutting down...');
  clearInterval(healthInterval);

  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);

  try {
    await worker.close();
    closeRedis();
    logger.info('Worker shut down gracefully');
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
  } finally {
    clearTimeout(forceExit);
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
