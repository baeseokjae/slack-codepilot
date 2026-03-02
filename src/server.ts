import { App, ExpressReceiver } from '@slack/bolt';
import pino from 'pino';
import { config } from './config/index.js';
import { getRedis } from './services/state.service.js';
import { registerActionHandlers } from './slack/actions.js';
import { registerCommandHandlers } from './slack/commands.js';
import { registerEventHandlers } from './slack/events.js';

const logger = pino({ name: 'server', level: config.LOG_LEVEL });

const receiver = new ExpressReceiver({
  signingSecret: config.SLACK_SIGNING_SECRET,
});

// Health check endpoint
receiver.router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

async function start(): Promise<void> {
  // Initialize Redis connection
  getRedis();

  await app.start(config.PORT);
  logger.info({ port: config.PORT }, 'Slack bot server started');
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
