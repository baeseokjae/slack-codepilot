import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { config } from '../config/index.js';
import { CircuitBreaker } from '../lib/circuit-breaker.js';
import { createLogger } from '../lib/logger.js';
import { githubRequestDuration, githubRequestsTotal } from '../lib/metrics.js';
import type { RepoInfo } from '../types/index.js';

const logger = createLogger('github-service');

const githubCircuitBreaker = new CircuitBreaker({
  name: 'github',
  failureThreshold: 5,
  resetTimeoutMs: 60000,
});

let octokit: Octokit | null = null;

function decodePrivateKey(key: string): string {
  if (key.startsWith('-----BEGIN')) {
    return key;
  }
  return Buffer.from(key, 'base64').toString('utf-8');
}

async function withGithubMetrics<T>(fn: () => Promise<T>): Promise<T> {
  const startTime = Date.now();
  let success = false;
  try {
    const result = await githubCircuitBreaker.execute(fn);
    success = true;
    return result;
  } finally {
    githubRequestDuration.observe((Date.now() - startTime) / 1000);
    githubRequestsTotal.inc({ status: success ? 'success' : 'error' });
  }
}

export function validateGitHubConfig(): void {
  if (!config.GITHUB_APP_ID || !config.GITHUB_PRIVATE_KEY || !config.GITHUB_INSTALLATION_ID) {
    throw new Error(
      'GitHub App configuration is incomplete. Set GITHUB_APP_ID, GITHUB_PRIVATE_KEY, and GITHUB_INSTALLATION_ID.',
    );
  }
}

export function getOctokit(): Octokit {
  if (octokit) return octokit;

  validateGitHubConfig();

  const appId = config.GITHUB_APP_ID as number;
  const privateKey = config.GITHUB_PRIVATE_KEY as string;
  const installationId = config.GITHUB_INSTALLATION_ID as number;

  octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey: decodePrivateKey(privateKey),
      installationId,
    },
  });

  return octokit;
}

export function fuzzyRepoScore(repoName: string, query: string): number {
  const r = repoName.toLowerCase();
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');

  // 정확히 일치
  if (r === q) return 1;
  // 하이픈/언더스코어 무시하고 일치 (code-pilot === codepilot)
  if (r.replace(/[-_]/g, '') === q) return 0.95;
  // query가 repo 이름에 포함
  if (r.includes(q)) return 0.8;
  // repo 이름이 query에 포함
  if (q.includes(r.replace(/[-_]/g, ''))) return 0.7;

  return 0;
}

async function searchInstallationRepo(repoName: string): Promise<{ owner: string; repo: string }> {
  const kit = getOctokit();

  // 1) GITHUB_DEFAULT_ORG가 설정되어 있으면 정확한 이름으로 직접 조회 시도
  if (config.GITHUB_DEFAULT_ORG) {
    try {
      await kit.repos.get({ owner: config.GITHUB_DEFAULT_ORG, repo: repoName });
      logger.info({ owner: config.GITHUB_DEFAULT_ORG, repo: repoName }, 'Resolved repo via GITHUB_DEFAULT_ORG');
      return { owner: config.GITHUB_DEFAULT_ORG, repo: repoName };
    } catch {
      logger.debug({ org: config.GITHUB_DEFAULT_ORG, repo: repoName }, 'Exact match not found under default org, trying fuzzy search');
    }
  }

  // 2) Installation 접근 가능 저장소에서 퍼지 매칭으로 검색
  type RepoEntry = { name: string; owner: { login: string } };
  let bestMatch: RepoEntry | null = null;
  let bestScore = 0;

  let page = 1;
  while (page <= 10) {
    const { data } = await kit.apps.listReposAccessibleToInstallation({ per_page: 100, page });
    for (const r of data.repositories) {
      const score = fuzzyRepoScore(r.name, repoName);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = r as RepoEntry;
      }
      if (score === 1) break;
    }
    if (bestScore === 1 || data.repositories.length < 100) break;
    page++;
  }

  if (bestMatch && bestScore >= 0.7) {
    logger.info(
      { query: repoName, matched: bestMatch.name, owner: bestMatch.owner.login, score: bestScore },
      'Resolved repo via fuzzy installation search',
    );
    return { owner: bestMatch.owner.login, repo: bestMatch.name };
  }

  throw new Error(
    `Repository "${repoName}" not found. Set GITHUB_DEFAULT_ORG env var or specify as "owner/repo".`,
  );
}

export async function resolveRepo(repoFullName: string): Promise<RepoInfo> {
  const parts = repoFullName.split('/');

  let owner: string;
  let repo: string;

  if (parts.length === 2 && parts[0] && parts[1]) {
    [owner, repo] = parts;
  } else if (parts.length === 1 && parts[0]) {
    const resolved = await withGithubMetrics(() => searchInstallationRepo(parts[0]));
    owner = resolved.owner;
    repo = resolved.repo;
  } else {
    throw new Error(`Invalid repo format: "${repoFullName}". Expected "owner/repo" or "repo".`);
  }

  return withGithubMetrics(async () => {
    const kit = getOctokit();
    const { data } = await kit.repos.get({ owner, repo });
    logger.info({ owner, repo, defaultBranch: data.default_branch }, 'Resolved repository');

    return {
      owner,
      repo,
      defaultBranch: data.default_branch,
    };
  });
}

export async function searchGitHubUserByEmail(email: string): Promise<string | null> {
  try {
    const kit = getOctokit();
    const { data } = await kit.search.users({ q: `${email} in:email`, per_page: 1 });
    if (data.total_count > 0) {
      const username = data.items[0].login;
      logger.info({ email, username }, 'Resolved GitHub user from email');
      return username;
    }
    logger.debug({ email }, 'No GitHub user found for email');
    return null;
  } catch (err) {
    logger.error({ err, email }, 'Failed to search GitHub user by email');
    return null;
  }
}

export async function createIssue(params: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
}): Promise<{ number: number; url: string }> {
  return withGithubMetrics(async () => {
    const kit = getOctokit();
    const { data } = await kit.issues.create({
      owner: params.owner,
      repo: params.repo,
      title: params.title,
      body: params.body,
      labels: params.labels,
      assignees: params.assignees,
    });
    logger.info({ issueNumber: data.number, url: data.html_url, assignees: params.assignees }, 'Created GitHub issue');
    return { number: data.number, url: data.html_url };
  });
}

export async function createPullRequest(params: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}): Promise<{ number: number; url: string }> {
  return withGithubMetrics(async () => {
    const kit = getOctokit();
    const { data } = await kit.pulls.create({
      owner: params.owner,
      repo: params.repo,
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
    });
    logger.info({ prNumber: data.number, url: data.html_url }, 'Created pull request');
    return { number: data.number, url: data.html_url };
  });
}

export async function findExistingIssue(params: {
  owner: string;
  repo: string;
  title: string;
}): Promise<{ number: number; url: string } | null> {
  return withGithubMetrics(async () => {
    const kit = getOctokit();
    const { data } = await kit.issues.listForRepo({
      owner: params.owner,
      repo: params.repo,
      state: 'open',
      per_page: 100,
    });
    const existing = data.find((issue) => issue.title === params.title && !issue.pull_request);
    if (existing) {
      logger.info({ issueNumber: existing.number }, 'Found existing issue');
      return { number: existing.number, url: existing.html_url };
    }
    return null;
  });
}

export async function findExistingPR(params: {
  owner: string;
  repo: string;
  head: string;
}): Promise<{ number: number; url: string } | null> {
  return withGithubMetrics(async () => {
    const kit = getOctokit();
    const { data } = await kit.pulls.list({
      owner: params.owner,
      repo: params.repo,
      head: `${params.owner}:${params.head}`,
      state: 'open',
    });
    if (data.length > 0) {
      logger.info({ prNumber: data[0].number }, 'Found existing PR');
      return { number: data[0].number, url: data[0].html_url };
    }
    return null;
  });
}

export async function addAssignees(params: {
  owner: string;
  repo: string;
  issueNumber: number;
  assignees: string[];
}): Promise<void> {
  if (!params.assignees.length) return;

  return withGithubMetrics(async () => {
    const kit = getOctokit();
    await kit.issues.addAssignees({
      owner: params.owner,
      repo: params.repo,
      issue_number: params.issueNumber,
      assignees: params.assignees,
    });
    logger.info({ issueNumber: params.issueNumber, assignees: params.assignees }, 'Added assignees');
  });
}

export async function requestReviewers(params: {
  owner: string;
  repo: string;
  pullNumber: number;
  reviewers?: string[];
  teamReviewers?: string[];
}): Promise<void> {
  if (!params.reviewers?.length && !params.teamReviewers?.length) return;

  return withGithubMetrics(async () => {
    const kit = getOctokit();
    await kit.pulls.requestReviewers({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.pullNumber,
      reviewers: params.reviewers,
      team_reviewers: params.teamReviewers,
    });
    logger.info(
      { prNumber: params.pullNumber, reviewers: params.reviewers, teamReviewers: params.teamReviewers },
      'Requested PR reviewers',
    );
  });
}

export async function getAuthenticatedCloneUrl(owner: string, repo: string): Promise<string> {
  return withGithubMetrics(async () => {
    const kit = getOctokit();
    const auth = (await kit.auth({ type: 'installation' })) as { token: string };
    return `https://x-access-token:${auth.token}@github.com/${owner}/${repo}.git`;
  });
}
