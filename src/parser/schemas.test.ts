import { describe, expect, it } from 'vitest';
import { parsedRequestSchema } from './schemas.js';

describe('parsedRequestSchema', () => {
  const validRequest = {
    type: 'fix',
    title: '로그인 버그 수정',
    description: '로그인 시 500 에러가 발생하는 문제',
    targetRepo: 'my-app',
    priority: 'high',
    missingInfo: null,
  };

  it('should accept a valid request', () => {
    const result = parsedRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it('should accept all valid types', () => {
    for (const type of ['feature', 'fix', 'refactor', 'docs', 'test']) {
      const result = parsedRequestSchema.safeParse({ ...validRequest, type });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid type', () => {
    const result = parsedRequestSchema.safeParse({ ...validRequest, type: 'deploy' });
    expect(result.success).toBe(false);
  });

  it('should accept all valid priorities', () => {
    for (const priority of ['low', 'medium', 'high']) {
      const result = parsedRequestSchema.safeParse({ ...validRequest, priority });
      expect(result.success).toBe(true);
    }
  });

  it('should accept missingInfo array', () => {
    const result = parsedRequestSchema.safeParse({
      ...validRequest,
      missingInfo: ['어떤 레포인지', '재현 단계가 어떻게 되는지'],
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty title', () => {
    const result = parsedRequestSchema.safeParse({ ...validRequest, title: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing fields', () => {
    const result = parsedRequestSchema.safeParse({ type: 'fix' });
    expect(result.success).toBe(false);
  });

  it('should accept acceptanceCriteria as a string array', () => {
    const result = parsedRequestSchema.safeParse({
      ...validRequest,
      acceptanceCriteria: ['User can log in with email and password', 'Error message is shown on invalid credentials'],
    });
    expect(result.success).toBe(true);
  });

  it('should accept acceptanceCriteria as null', () => {
    const result = parsedRequestSchema.safeParse({
      ...validRequest,
      acceptanceCriteria: null,
    });
    expect(result.success).toBe(true);
  });

  it('should accept missing acceptanceCriteria for backward compatibility', () => {
    const result = parsedRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });
});
