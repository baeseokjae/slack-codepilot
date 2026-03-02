import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import { simpleGit } from 'simple-git';
import { config } from '../../config/index.js';
import { getAuthenticatedCloneUrl } from '../../services/github.service.js';
import type { PipelineContext } from '../types.js';

const logger = pino({ name: 'step:clone-repo', level: config.LOG_LEVEL });

export function generateBranchName(type: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `codepilot/${type}/${slug || 'task'}`;
}

export async function cloneRepoStep(ctx: PipelineContext): Promise<void> {
  if (!ctx.repoInfo) {
    throw new Error('repoInfo is required for clone step');
  }

  const { owner, repo, defaultBranch } = ctx.repoInfo;
  const branchName = generateBranchName(ctx.request.type, ctx.request.title);
  ctx.branchName = branchName;

  const workspacePath = path.join(config.GIT_WORKSPACE_DIR, `${ctx.jobId}-${repo}`);
  ctx.workspacePath = workspacePath;

  await fs.mkdir(workspacePath, { recursive: true });

  const cloneUrl = await getAuthenticatedCloneUrl(owner, repo);

  logger.info({ workspacePath, branchName }, 'Cloning repository');

  const git = simpleGit();
  await git.clone(cloneUrl, workspacePath, ['--depth', '1', '--branch', defaultBranch]);

  const repoGit = simpleGit(workspacePath);
  await repoGit.addConfig('user.name', 'CodePilot Bot');
  await repoGit.addConfig('user.email', 'codepilot-bot@users.noreply.github.com');
  await repoGit.checkoutLocalBranch(branchName);

  logger.info({ branchName, workspacePath }, 'Repository cloned and branch created');
}
