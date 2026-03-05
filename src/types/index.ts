export interface ParsedRequest {
  type: 'feature' | 'fix' | 'refactor' | 'docs' | 'test';
  title: string;
  description: string;
  targetRepo: string | null;
  priority: 'low' | 'medium' | 'high';
  confidence: number;
  missingInfo: string[] | null;
}

export interface ThreadContext {
  threadTs: string;
  channelId: string;
  userId: string;
  originalText: string;
  parsedRequest: ParsedRequest | null;
  followUpCount: number;
  messages: ConversationMessage[];
  createdAt: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface PipelineState {
  id: string;
  threadTs: string;
  channelId: string;
  userId?: string;
  request: ParsedRequest;
  status: 'pending_confirmation' | 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  currentStep?: PipelineStep;
  stepTimings?: Record<string, number>;
  issueNumber?: number;
  issueUrl?: string;
  branchName?: string;
  prNumber?: number;
  prUrl?: string;
  error?: string;
  progressTs?: string;
  cancelledBy?: string;
  cancelledAt?: number;
}

export type PipelineStep =
  | 'create_issue'
  | 'clone_repo'
  | 'generate_code'
  | 'apply_and_push'
  | 'create_pr';

export interface CodeChange {
  filePath: string;
  content: string;
  action: 'create' | 'update' | 'delete';
}

export interface RepoInfo {
  owner: string;
  repo: string;
  defaultBranch: string;
}
