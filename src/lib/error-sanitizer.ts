const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Slack tokens (xoxb-, xoxp-, xoxa-, xoxs-)
  { pattern: /xox[bpas]-[a-zA-Z0-9-]+/g, replacement: '[REDACTED]' },
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  { pattern: /gh[pousr]_[a-zA-Z0-9]+/g, replacement: '[REDACTED]' },
  // OpenAI/API keys (sk-)
  { pattern: /sk-[a-zA-Z0-9]+/g, replacement: '[REDACTED]' },
  // PEM private keys
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED]',
  },
  // Redis URLs with passwords (redis://:password@host)
  { pattern: /redis:\/\/:[^@]+@/g, replacement: 'redis://:[REDACTED]@' },
  // Generic Bearer tokens
  { pattern: /Bearer\s+[a-zA-Z0-9._-]+/g, replacement: 'Bearer [REDACTED]' },
];

export function sanitizeError(message: string): string {
  let result = message;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function sanitizeErrorObject(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return sanitizeError(message);
}
