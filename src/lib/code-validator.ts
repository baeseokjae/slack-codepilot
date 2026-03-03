import type { CodeChange } from '../types/index.js';

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /rm\s+-rf\s+\//, label: 'rm -rf /' },
  { pattern: /\beval\s*\(/, label: 'eval()' },
  { pattern: /\bexec\s*\(/, label: 'exec()' },
  { pattern: /child_process/, label: 'child_process' },
  { pattern: /process\.env/, label: 'process.env access' },
  { pattern: /new\s+Function\s*\(/, label: 'Function constructor' },
  { pattern: /require\s*\(\s*['"`]child_process/, label: 'require child_process' },
  { pattern: /import\s+.*child_process/, label: 'import child_process' },
];

export function validateCodeChanges(changes: CodeChange[]): void {
  const violations: string[] = [];

  for (const change of changes) {
    if (change.action === 'delete') {
      continue;
    }

    const matched: string[] = [];
    for (const { pattern, label } of DANGEROUS_PATTERNS) {
      if (pattern.test(change.content)) {
        matched.push(label);
      }
    }

    if (matched.length > 0) {
      violations.push(`${change.filePath}: ${matched.join(', ')}`);
    }
  }

  if (violations.length > 0) {
    throw new Error(`Dangerous patterns detected:\n${violations.join('\n')}`);
  }
}
