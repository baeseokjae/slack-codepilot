import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/metrics.js', () => ({
  githubRequestDuration: { observe: vi.fn() },
  githubRequestsTotal: { inc: vi.fn() },
}));

vi.mock('../lib/circuit-breaker.js', () => ({
  CircuitBreaker: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  })),
}));

vi.mock('../config/index.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    GITHUB_APP_ID: undefined,
    GITHUB_PRIVATE_KEY: undefined,
    GITHUB_INSTALLATION_ID: undefined,
  },
}));

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(),
}));

vi.mock('@octokit/auth-app', () => ({
  createAppAuth: vi.fn(),
}));

import { config } from '../config/index.js';
import { resolveRepo, validateGitHubConfig } from './github.service.js';

describe('github.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateGitHubConfig', () => {
    it('should throw when GITHUB_APP_ID is missing', () => {
      expect(() => validateGitHubConfig()).toThrow('GitHub App configuration is incomplete');
    });

    it('should throw when GITHUB_PRIVATE_KEY is missing', () => {
      Object.assign(config, { GITHUB_APP_ID: 123 });
      expect(() => validateGitHubConfig()).toThrow('GitHub App configuration is incomplete');
      Object.assign(config, { GITHUB_APP_ID: undefined });
    });

    it('should throw when GITHUB_INSTALLATION_ID is missing', () => {
      Object.assign(config, {
        GITHUB_APP_ID: 123,
        GITHUB_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
      });
      expect(() => validateGitHubConfig()).toThrow('GitHub App configuration is incomplete');
      Object.assign(config, {
        GITHUB_APP_ID: undefined,
        GITHUB_PRIVATE_KEY: undefined,
      });
    });

    it('should not throw when all config is present', () => {
      Object.assign(config, {
        GITHUB_APP_ID: 123,
        GITHUB_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
        GITHUB_INSTALLATION_ID: 456,
      });
      expect(() => validateGitHubConfig()).not.toThrow();
      Object.assign(config, {
        GITHUB_APP_ID: undefined,
        GITHUB_PRIVATE_KEY: undefined,
        GITHUB_INSTALLATION_ID: undefined,
      });
    });
  });

  describe('resolveRepo', () => {
    it('should throw on missing slash in repo name', async () => {
      Object.assign(config, {
        GITHUB_APP_ID: 123,
        GITHUB_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
        GITHUB_INSTALLATION_ID: 456,
      });
      await expect(resolveRepo('just-repo')).rejects.toThrow('Expected "owner/repo"');
      Object.assign(config, {
        GITHUB_APP_ID: undefined,
        GITHUB_PRIVATE_KEY: undefined,
        GITHUB_INSTALLATION_ID: undefined,
      });
    });

    it('should throw on empty owner or repo', async () => {
      Object.assign(config, {
        GITHUB_APP_ID: 123,
        GITHUB_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
        GITHUB_INSTALLATION_ID: 456,
      });
      await expect(resolveRepo('/repo')).rejects.toThrow('Expected "owner/repo"');
      Object.assign(config, {
        GITHUB_APP_ID: undefined,
        GITHUB_PRIVATE_KEY: undefined,
        GITHUB_INSTALLATION_ID: undefined,
      });
    });

    it('should throw on triple-segment repo name', async () => {
      Object.assign(config, {
        GITHUB_APP_ID: 123,
        GITHUB_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
        GITHUB_INSTALLATION_ID: 456,
      });
      await expect(resolveRepo('a/b/c')).rejects.toThrow('Expected "owner/repo"');
      Object.assign(config, {
        GITHUB_APP_ID: undefined,
        GITHUB_PRIVATE_KEY: undefined,
        GITHUB_INSTALLATION_ID: undefined,
      });
    });
  });
});
