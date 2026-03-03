import { describe, expect, it } from 'vitest';
import { sanitizeError, sanitizeErrorObject } from './error-sanitizer.js';

describe('sanitizeError', () => {
  it('민감 정보가 없는 일반 메시지는 그대로 반환', () => {
    const message = 'Something went wrong while processing the request';
    expect(sanitizeError(message)).toBe(message);
  });

  it('Slack 토큰 (xoxb-...) → [REDACTED]', () => {
    const message = 'Auth failed with token xoxb-123-456-abc';
    expect(sanitizeError(message)).toBe('Auth failed with token [REDACTED]');
  });

  it('GitHub 토큰 (ghp_...) → [REDACTED]', () => {
    const message = 'Push rejected: token ghp_abcdef1234567890 is invalid';
    expect(sanitizeError(message)).toBe('Push rejected: token [REDACTED] is invalid');
  });

  it('API 키 (sk-...) → [REDACTED]', () => {
    const message = 'Invalid API key: sk-abcdef1234567890';
    expect(sanitizeError(message)).toBe('Invalid API key: [REDACTED]');
  });

  it('PEM 개인키 → [REDACTED]', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const message = `Key data: ${pem}`;
    expect(sanitizeError(message)).toBe('Key data: [REDACTED]');
  });

  it('Redis URL 비밀번호 → redis://:[REDACTED]@', () => {
    const message = 'Cannot connect to redis://:supersecret@localhost:6379';
    expect(sanitizeError(message)).toBe('Cannot connect to redis://:[REDACTED]@localhost:6379');
  });

  it('Bearer 토큰 → Bearer [REDACTED]', () => {
    const message = 'Request header: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig';
    expect(sanitizeError(message)).toBe('Request header: Authorization: Bearer [REDACTED]');
  });

  it('하나의 문자열에 여러 민감 정보 → 모두 마스킹', () => {
    const message =
      'slack=xoxb-111-222-abc github=ghp_tokenXYZ api=sk-keyABC auth=Bearer mytoken123';
    expect(sanitizeError(message)).toBe(
      'slack=[REDACTED] github=[REDACTED] api=[REDACTED] auth=Bearer [REDACTED]',
    );
  });
});

describe('sanitizeErrorObject', () => {
  it('Error 객체 처리 — message 필드를 sanitize하여 반환', () => {
    const err = new Error('Token xoxb-123-abc is expired');
    expect(sanitizeErrorObject(err)).toBe('Token [REDACTED] is expired');
  });

  it('non-Error 값 처리 — 문자열은 String()을 거쳐 sanitize', () => {
    expect(sanitizeErrorObject('API key sk-secret123 rejected')).toBe(
      'API key [REDACTED] rejected',
    );
  });

  it('non-Error 값 처리 — 숫자는 String()을 거쳐 그대로 반환', () => {
    expect(sanitizeErrorObject(42)).toBe('42');
  });

  it('non-Error 값 처리 — null은 "null" 문자열로 반환', () => {
    expect(sanitizeErrorObject(null)).toBe('null');
  });
});
