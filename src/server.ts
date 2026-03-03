import { App, ExpressReceiver } from '@slack/bolt';
import pino from 'pino';
import { config } from './config/index.js';
import type { HealthStatus } from './lib/health.js';
import { checkBullMQHealth, checkRedisHealth, deriveOverallStatus } from './lib/health.js';
import { closeRedis, getRedis } from './services/state.service.js';
import { registerActionHandlers } from './slack/actions.js';
import { registerCommandHandlers } from './slack/commands.js';
import { registerEventHandlers } from './slack/events.js';

const logger = pino({ name: 'server', level: config.LOG_LEVEL });

const startTime = Date.now();

const SHUTDOWN_TIMEOUT_MS = 30000;

const receiver = new ExpressReceiver({
  signingSecret: config.SLACK_SIGNING_SECRET,
});

// Health check endpoint
receiver.router.get('/health', async (_req, res) => {
  const redis = getRedis();
  const [redisHealth, bullmqHealth] = await Promise.all([
    checkRedisHealth(redis),
    checkBullMQHealth('codepilot-tasks', redis),
  ]);

  const services = { redis: redisHealth, bullmq: bullmqHealth };
  const status = deriveOverallStatus(services);

  const health: HealthStatus = {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    services,
  };

  res.status(status === 'unhealthy' ? 503 : 200).json(health);
});

const app = new App({
  token: config.SLACK_BOT_TOKEN,
  receiver,
});

// Register event handlers
registerEventHandlers(app);

// Register action handlers (Phase 3)
registerActionHandlers(app);

// Register command handlers (Phase 3)
registerCommandHandlers(app);

let server: Awaited<ReturnType<typeof app.start>>;

async function start(): Promise<void> {
  // Initialize Redis connection
  getRedis();

  server = await app.start(config.PORT);
  logger.info({ port: config.PORT }, 'Slack bot server started');
}

let isShuttingDown = false;

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info('Server shutting down...');

  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    closeRedis();
    logger.info('Server shut down gracefully');
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
  } finally {
    clearTimeout(forceExit);
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
