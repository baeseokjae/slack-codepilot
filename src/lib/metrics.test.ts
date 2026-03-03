import { describe, expect, it } from 'vitest';
import {
  circuitBreakerState,
  metricsRegistry,
  pipelineDuration,
  pipelineStepDuration,
  pipelineTotal,
  queueJobs,
  slackEventsTotal,
} from './metrics.js';

const CODEPILOT_METRICS = [
  'codepilot_pipeline_total',
  'codepilot_pipeline_duration_seconds',
  'codepilot_pipeline_step_duration_seconds',
  'codepilot_ai_requests_total',
  'codepilot_ai_request_duration_seconds',
  'codepilot_github_requests_total',
  'codepilot_github_request_duration_seconds',
  'codepilot_circuit_breaker_state',
  'codepilot_queue_jobs',
  'codepilot_slack_events_total',
];

describe('metrics', () => {
  it('should register all codepilot metrics', async () => {
    const metrics = await metricsRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    for (const name of CODEPILOT_METRICS) {
      expect(names).toContain(name);
    }
  });

  it('should include default Node.js metrics', async () => {
    const metrics = await metricsRegistry.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);
    expect(names.some((n) => n.startsWith('process_') || n.startsWith('nodejs_'))).toBe(true);
  });

  it('should increment counters without error', () => {
    pipelineTotal.inc({ status: 'completed' });
    slackEventsTotal.inc({ type: 'mention' });
  });

  it('should observe histograms without error', () => {
    pipelineDuration.observe(5.2);
    pipelineStepDuration.observe({ step: 'generate_code' }, 3.1);
  });

  it('should set gauges without error', () => {
    circuitBreakerState.set({ name: 'ai' }, 0);
    queueJobs.set({ status: 'waiting' }, 5);
  });

  it('should produce valid Prometheus text output', async () => {
    const text = await metricsRegistry.metrics();
    expect(text).toContain('codepilot_pipeline_total');
    expect(text).toContain('# HELP');
    expect(text).toContain('# TYPE');
  });
});
