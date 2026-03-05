import pino from 'pino';
import { config } from '../config/index.js';

const isDev = process.env.NODE_ENV !== 'production';

const rootLogger = pino({
  level: config.LOG_LEVEL,
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
});

export function createLogger(name: string, correlationId?: string): pino.Logger {
  const bindings: Record<string, string> = { name };
  if (correlationId) {
    bindings.correlationId = correlationId;
  }
  return rootLogger.child(bindings);
}
