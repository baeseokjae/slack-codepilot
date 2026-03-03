import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent' },
}));

import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('should return a pino logger with the given name', () => {
    const logger = createLogger('test-module');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should bind correlationId when provided', () => {
    const logger = createLogger('test-module', 'abc-123');
    const bindings = logger.bindings();
    expect(bindings.name).toBe('test-module');
    expect(bindings.correlationId).toBe('abc-123');
  });

  it('should NOT have correlationId when not provided', () => {
    const logger = createLogger('test-module');
    const bindings = logger.bindings();
    expect(bindings.name).toBe('test-module');
    expect(bindings.correlationId).toBeUndefined();
  });
});
