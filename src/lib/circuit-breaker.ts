import pino from 'pino';
import { circuitBreakerState } from './metrics.js';

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number; // 연속 실패 횟수로 open 전환
  resetTimeoutMs: number; // open 유지 시간 (ms)
}

const STATE_VALUES: Record<CircuitState, number> = { closed: 0, open: 1, 'half-open': 2 };

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly logger;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.logger = pino({ name: `circuit-breaker:${options.name}`, level: 'info' });
  }

  private updateMetric(): void {
    circuitBreakerState.set({ name: this.options.name }, STATE_VALUES[this.state]);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeoutMs) {
        this.state = 'half-open';
        this.updateMetric();
        this.logger.info('Circuit half-open, testing...');
      } else {
        throw new Error(`Circuit breaker is open for ${this.options.name}`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.logger.info('Circuit closed (recovered)');
    }
    this.failureCount = 0;
    this.state = 'closed';
    this.updateMetric();
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.state = 'open';
      this.updateMetric();
      this.logger.warn('Circuit re-opened after half-open failure');
      return;
    }

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = 'open';
      this.updateMetric();
      this.logger.error({ failureCount: this.failureCount }, 'Circuit opened');
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.updateMetric();
  }
}
