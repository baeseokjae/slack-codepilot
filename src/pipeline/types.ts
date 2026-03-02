import type { CodeChange, ParsedRequest, RepoInfo } from '../types/index.js';

export interface PipelineContext {
  jobId: string;
  channelId: string;
  threadTs: string;
  userId: string;
  request: ParsedRequest;
  repoInfo?: RepoInfo;
  issueNumber?: number;
  issueUrl?: string;
  branchName?: string;
  workspacePath?: string;
  codeChanges?: CodeChange[];
  prNumber?: number;
  prUrl?: string;
}

export type PipelineStepHandler = (ctx: PipelineContext) => Promise<void>;
