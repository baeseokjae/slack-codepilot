import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import pino from 'pino';
import { config } from '../config/index.js';
import type { RepoInfo } from '../types/index.js';

const logger = pino({ name: 'github-service', level: config.LOG_LEVEL });

let octokit: Octokit | null = null;

function decodePrivateKey(key: string): string {
  if (key.startsWith('-----BEGIN')) {
    return key;
  }
  return Buffer.from(key, 'base64').toString('utf-8');
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

export async function resolveRepo(repoFullName: string): Promise<RepoInfo> {
  const kit = getOctokit();
  const parts = repoFullName.split('/');

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo format: "${repoFullName}". Expected "owner/repo".`);
  }

  const [owner, repo] = parts;

  const { data } = await kit.repos.get({ owner, repo });
  logger.info({ owner, repo, defaultBranch: data.default_branch }, 'Resolved repository');

  return {
    owner,
    repo,
    defaultBranch: data.default_branch,
  };
}

export async function createIssue(params: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
}): Promise<{ number: number; url: string }> {
  const kit = getOctokit();
  const { data } = await kit.issues.create({
    owner: params.owner,
    repo: params.repo,
    title: params.title,
    body: params.body,
    labels: params.labels,
  });
  logger.info({ issueNumber: data.number, url: data.html_url }, 'Created GitHub issue');
  return { number: data.number, url: data.html_url };
}

export async function createPullRequest(params: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}): Promise<{ number: number; url: string }> {
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
}

export async function findExistingIssue(params: {
  owner: string;
  repo: string;
  title: string;
}): Promise<{ number: number; url: string } | null> {
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
}

export async function findExistingPR(params: {
  owner: string;
  repo: string;
  head: string;
}): Promise<{ number: number; url: string } | null> {
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
}

export async function getAuthenticatedCloneUrl(owner: string, repo: string): Promise<string> {
  const kit = getOctokit();
  const auth = (await kit.auth({ type: 'installation' })) as { token: string };
  return `https://x-access-token:${auth.token}@github.com/${owner}/${repo}.git`;
}
