import type { CodeChange, ConversationMessage, ParsedRequest, RepoInfo } from '../types/index.js';

export interface PipelineContext {
  jobId: string;
  correlationId: string;
  channelId: string;
  threadTs: string;
  userId: string;
  request: ParsedRequest;
  conversationHistory?: ConversationMessage[];
  repoInfo?: RepoInfo;
  issueNumber?: number;
  issueUrl?: string;
  branchName?: string;
  workspacePath?: string;
  codeChanges?: CodeChange[];
  githubUsername?: string;
  notionPageId?: string;
  notionPageUrl?: string;
  prNumber?: number;
  prUrl?: string;
}

export type PipelineStepHandler = (ctx: PipelineContext) => Promise<void>;
