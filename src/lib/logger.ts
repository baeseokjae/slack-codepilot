import pino from 'pino';
import { config } from '../config/index.js';

const rootLogger = pino({ level: config.LOG_LEVEL });

export function createLogger(name: string, correlationId?: string): pino.Logger {
  const bindings: Record<string, string> = { name };
  if (correlationId) {
    bindings.correlationId = correlationId;
  }
  return rootLogger.child(bindings);
}
