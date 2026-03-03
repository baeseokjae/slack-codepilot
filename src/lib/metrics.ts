import client, { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const metricsRegistry = new Registry();
client.collectDefaultMetrics({ register: metricsRegistry });

// Pipeline
export const pipelineTotal = new Counter({
  name: 'codepilot_pipeline_total',
  help: 'Total pipeline executions',
  labelNames: ['status'] as const,
  registers: [metricsRegistry],
});

export const pipelineDuration = new Histogram({
  name: 'codepilot_pipeline_duration_seconds',
  help: 'Pipeline total execution duration in seconds',
  buckets: [5, 10, 30, 60, 120, 300, 600],
  registers: [metricsRegistry],
});

export const pipelineStepDuration = new Histogram({
  name: 'codepilot_pipeline_step_duration_seconds',
  help: 'Pipeline step execution duration in seconds',
  labelNames: ['step'] as const,
  buckets: [1, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});

// AI
export const aiRequestsTotal = new Counter({
  name: 'codepilot_ai_requests_total',
  help: 'Total AI API requests',
  labelNames: ['status'] as const,
  registers: [metricsRegistry],
});

export const aiRequestDuration = new Histogram({
  name: 'codepilot_ai_request_duration_seconds',
  help: 'AI API request duration in seconds',
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

// GitHub
export const githubRequestsTotal = new Counter({
  name: 'codepilot_github_requests_total',
  help: 'Total GitHub API requests',
  labelNames: ['status'] as const,
  registers: [metricsRegistry],
});

export const githubRequestDuration = new Histogram({
  name: 'codepilot_github_request_duration_seconds',
  help: 'GitHub API request duration in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

// Circuit Breaker
export const circuitBreakerState = new Gauge({
  name: 'codepilot_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['name'] as const,
  registers: [metricsRegistry],
});

// Queue
export const queueJobs = new Gauge({
  name: 'codepilot_queue_jobs',
  help: 'Number of jobs in queue by status',
  labelNames: ['status'] as const,
  registers: [metricsRegistry],
});

// Slack Events
export const slackEventsTotal = new Counter({
  name: 'codepilot_slack_events_total',
  help: 'Total Slack events received',
  labelNames: ['type'] as const,
  registers: [metricsRegistry],
});
