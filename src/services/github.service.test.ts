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
    GITHUB_DEFAULT_ORG: undefined,
  },
}));

const mockReposGet = vi.fn();
const mockListRepos = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    repos: { get: mockReposGet },
    apps: { listReposAccessibleToInstallation: mockListRepos },
  })),
}));

vi.mock('@octokit/auth-app', () => ({
  createAppAuth: vi.fn(),
}));

import { config } from '../config/index.js';
import { fuzzyRepoScore, resolveRepo, validateGitHubConfig } from './github.service.js';

function withGitHubConfig(fn: () => Promise<void> | void, extra?: Partial<typeof config>) {
  return async () => {
    Object.assign(config, {
      GITHUB_APP_ID: 123,
      GITHUB_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
      GITHUB_INSTALLATION_ID: 456,
      ...extra,
    });
    try {
      await fn();
    } finally {
      Object.assign(config, {
        GITHUB_APP_ID: undefined,
        GITHUB_PRIVATE_KEY: undefined,
        GITHUB_INSTALLATION_ID: undefined,
        GITHUB_DEFAULT_ORG: undefined,
      });
    }
  };
}

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

  describe('fuzzyRepoScore', () => {
    it('should return 1 for exact match', () => {
      expect(fuzzyRepoScore('codepilot', 'codepilot')).toBe(1);
    });

    it('should return 1 for case-insensitive exact match', () => {
      expect(fuzzyRepoScore('CodePilot', 'codepilot')).toBe(1);
    });

    it('should return 0.95 for hyphen/underscore ignored match', () => {
      expect(fuzzyRepoScore('code-pilot', 'codepilot')).toBe(0.95);
      expect(fuzzyRepoScore('code_pilot', 'codepilot')).toBe(0.95);
      expect(fuzzyRepoScore('slack-codepilot', 'slackcodepilot')).toBe(0.95);
    });

    it('should return 0.8 when query is contained in repo name', () => {
      expect(fuzzyRepoScore('slack-codepilot', 'codepilot')).toBe(0.8);
      expect(fuzzyRepoScore('my-codepilot-app', 'codepilot')).toBe(0.8);
    });

    it('should return 0.7 when repo name is contained in query', () => {
      expect(fuzzyRepoScore('pilot', 'codepilot')).toBe(0.7);
    });

    it('should return 0 for no match', () => {
      expect(fuzzyRepoScore('totally-different', 'codepilot')).toBe(0);
    });
  });

  describe('resolveRepo', () => {
    it(
      'should resolve owner/repo format directly',
      withGitHubConfig(async () => {
        mockReposGet.mockResolvedValue({
          data: { default_branch: 'main' },
        });

        const result = await resolveRepo('my-org/my-repo');
        expect(result).toEqual({ owner: 'my-org', repo: 'my-repo', defaultBranch: 'main' });
        expect(mockReposGet).toHaveBeenCalledWith({ owner: 'my-org', repo: 'my-repo' });
        expect(mockListRepos).not.toHaveBeenCalled();
      }),
    );

    it(
      'should resolve repo name via GITHUB_DEFAULT_ORG',
      withGitHubConfig(
        async () => {
          mockReposGet.mockResolvedValue({
            data: { default_branch: 'main' },
          });

          const result = await resolveRepo('codepilot');
          expect(result).toEqual({ owner: 'my-org', repo: 'codepilot', defaultBranch: 'main' });
          expect(mockReposGet).toHaveBeenCalledWith({ owner: 'my-org', repo: 'codepilot' });
          expect(mockListRepos).not.toHaveBeenCalled();
        },
        { GITHUB_DEFAULT_ORG: 'my-org' },
      ),
    );

    it(
      'should fall back to fuzzy installation search when GITHUB_DEFAULT_ORG lookup fails',
      withGitHubConfig(
        async () => {
          mockReposGet
            .mockRejectedValueOnce(new Error('Not Found'))
            .mockResolvedValueOnce({ data: { default_branch: 'main' } });
          mockListRepos.mockResolvedValue({
            data: {
              repositories: [{ name: 'codepilot', owner: { login: 'other-org' } }],
            },
          });

          const result = await resolveRepo('codepilot');
          expect(result).toEqual({ owner: 'other-org', repo: 'codepilot', defaultBranch: 'main' });
          expect(mockListRepos).toHaveBeenCalled();
        },
        { GITHUB_DEFAULT_ORG: 'my-org' },
      ),
    );

    it(
      'should fuzzy match "codepilot" to "code-pilot" in installation repos',
      withGitHubConfig(async () => {
        mockListRepos.mockResolvedValue({
          data: {
            repositories: [
              { name: 'unrelated-repo', owner: { login: 'org' } },
              { name: 'code-pilot', owner: { login: 'org' } },
            ],
          },
        });
        mockReposGet.mockResolvedValue({ data: { default_branch: 'main' } });

        const result = await resolveRepo('codepilot');
        expect(result).toEqual({ owner: 'org', repo: 'code-pilot', defaultBranch: 'main' });
      }),
    );

    it(
      'should prefer exact match over fuzzy match',
      withGitHubConfig(async () => {
        mockListRepos.mockResolvedValue({
          data: {
            repositories: [
              { name: 'slack-codepilot', owner: { login: 'org' } },
              { name: 'codepilot', owner: { login: 'org' } },
            ],
          },
        });
        mockReposGet.mockResolvedValue({ data: { default_branch: 'main' } });

        const result = await resolveRepo('codepilot');
        expect(result).toEqual({ owner: 'org', repo: 'codepilot', defaultBranch: 'main' });
      }),
    );

    it(
      'should fuzzy match partial name contained in repo',
      withGitHubConfig(async () => {
        mockListRepos.mockResolvedValue({
          data: {
            repositories: [
              { name: 'slack-codepilot', owner: { login: 'org' } },
            ],
          },
        });
        mockReposGet.mockResolvedValue({ data: { default_branch: 'main' } });

        const result = await resolveRepo('codepilot');
        expect(result).toEqual({ owner: 'org', repo: 'slack-codepilot', defaultBranch: 'main' });
      }),
    );

    it(
      'should search installation repos when only repo name is given (no default org)',
      withGitHubConfig(async () => {
        mockListRepos.mockResolvedValue({
          data: {
            repositories: [
              { name: 'codepilot', owner: { login: 'my-org' } },
              { name: 'other-repo', owner: { login: 'my-org' } },
            ],
          },
        });
        mockReposGet.mockResolvedValue({
          data: { default_branch: 'main' },
        });

        const result = await resolveRepo('codepilot');
        expect(result).toEqual({ owner: 'my-org', repo: 'codepilot', defaultBranch: 'main' });
        expect(mockListRepos).toHaveBeenCalledWith({ per_page: 100, page: 1 });
      }),
    );

    it(
      'should paginate through installation repos',
      withGitHubConfig(async () => {
        const page1Repos = Array.from({ length: 100 }, (_, i) => ({
          name: `repo-${i}`,
          owner: { login: 'org' },
        }));
        mockListRepos
          .mockResolvedValueOnce({ data: { repositories: page1Repos } })
          .mockResolvedValueOnce({
            data: { repositories: [{ name: 'codepilot', owner: { login: 'org' } }] },
          });
        mockReposGet.mockResolvedValue({ data: { default_branch: 'main' } });

        const result = await resolveRepo('codepilot');
        expect(result).toEqual({ owner: 'org', repo: 'codepilot', defaultBranch: 'main' });
        expect(mockListRepos).toHaveBeenCalledTimes(2);
        expect(mockListRepos).toHaveBeenCalledWith({ per_page: 100, page: 2 });
      }),
    );

    it(
      'should not match when score is below threshold',
      withGitHubConfig(async () => {
        mockListRepos.mockResolvedValue({
          data: { repositories: [{ name: 'totally-different', owner: { login: 'my-org' } }] },
        });

        await expect(resolveRepo('codepilot')).rejects.toThrow('not found');
      }),
    );

    it(
      'should throw on empty owner or repo',
      withGitHubConfig(async () => {
        await expect(resolveRepo('/repo')).rejects.toThrow('Expected "owner/repo" or "repo"');
      }),
    );

    it(
      'should throw on triple-segment repo name',
      withGitHubConfig(async () => {
        await expect(resolveRepo('a/b/c')).rejects.toThrow('Expected "owner/repo" or "repo"');
      }),
    );

    it(
      'should throw on empty string',
      withGitHubConfig(async () => {
        await expect(resolveRepo('')).rejects.toThrow('Expected "owner/repo" or "repo"');
      }),
    );
  });
});
