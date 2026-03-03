import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/index.js', () => ({
  config: { LOG_LEVEL: 'silent' },
}));

vi.mock('../../lib/code-validator.js', () => ({
  validateCodeChanges: vi.fn(),
}));

const mockAdd = vi.fn().mockResolvedValue(undefined);
const mockCommit = vi.fn().mockResolvedValue(undefined);
const mockPush = vi.fn().mockResolvedValue(undefined);

vi.mock('simple-git', () => ({
  simpleGit: vi.fn().mockImplementation(() => ({
    add: mockAdd,
    commit: mockCommit,
    push: mockPush,
  })),
}));

vi.mock('../../services/slack-notifier.service.js', () => ({
  notify: vi.fn(),
}));

import { validateCodeChanges } from '../../lib/code-validator.js';
import { notify } from '../../services/slack-notifier.service.js';
import type { PipelineContext } from '../types.js';
import { applyAndPushStep } from './apply-and-push.js';

const mockNotify = vi.mocked(notify);
const mockValidateCodeChanges = vi.mocked(validateCodeChanges);

describe('applyAndPushStep', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepilot-apply-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
    return {
      jobId: 'job-1',
      channelId: 'C123',
      threadTs: 'ts123',
      userId: 'U123',
      request: {
        type: 'feature',
        title: 'Add feature',
        description: 'New feature',
        targetRepo: 'owner/repo',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
      workspacePath: tmpDir,
      branchName: 'codepilot/feature/add-feature',
      issueNumber: 42,
      codeChanges: [],
      ...overrides,
    };
  }

  it('should throw when required fields are missing', async () => {
    const ctx = makeCtx({ workspacePath: undefined });
    await expect(applyAndPushStep(ctx)).rejects.toThrow('required');
  });

  it('should create new files', async () => {
    const ctx = makeCtx({
      codeChanges: [
        { filePath: 'src/new-file.ts', content: 'export const x = 1;', action: 'create' },
      ],
    });

    await applyAndPushStep(ctx);

    const content = await fs.readFile(path.join(tmpDir, 'src/new-file.ts'), 'utf-8');
    expect(content).toBe('export const x = 1;');
  });

  it('should create nested directories for new files', async () => {
    const ctx = makeCtx({
      codeChanges: [{ filePath: 'src/deep/nested/file.ts', content: 'test', action: 'create' }],
    });

    await applyAndPushStep(ctx);

    const content = await fs.readFile(path.join(tmpDir, 'src/deep/nested/file.ts'), 'utf-8');
    expect(content).toBe('test');
  });

  it('should delete files', async () => {
    const filePath = path.join(tmpDir, 'to-delete.ts');
    await fs.writeFile(filePath, 'old content');

    const ctx = makeCtx({
      codeChanges: [{ filePath: 'to-delete.ts', content: '', action: 'delete' }],
    });

    await applyAndPushStep(ctx);

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('should call git add, commit, and push', async () => {
    const ctx = makeCtx({
      codeChanges: [{ filePath: 'file.ts', content: 'test', action: 'create' }],
    });

    await applyAndPushStep(ctx);

    expect(mockAdd).toHaveBeenCalledWith('.');
    expect(mockCommit).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith('origin', 'codepilot/feature/add-feature', ['--force']);
  });

  it('should send Slack notification after push', async () => {
    const ctx = makeCtx({
      codeChanges: [{ filePath: 'file.ts', content: 'test', action: 'create' }],
    });

    await applyAndPushStep(ctx);

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify.mock.calls[0][2]).toContain('push');
  });

  it('should skip files with path traversal attempts', async () => {
    const ctx = makeCtx({
      codeChanges: [
        { filePath: '../../../etc/passwd', content: 'malicious', action: 'create' },
        { filePath: 'safe-file.ts', content: 'safe', action: 'create' },
      ],
    });

    await applyAndPushStep(ctx);

    // The malicious file should NOT have been created outside workspace
    const safeContent = await fs.readFile(path.join(tmpDir, 'safe-file.ts'), 'utf-8');
    expect(safeContent).toBe('safe');

    // Verify the path traversal file wasn't created
    await expect(fs.access(path.resolve(tmpDir, '../../../etc/passwd'))).rejects.toThrow();
  });

  it('should include issue number in commit message', async () => {
    const ctx = makeCtx({
      issueNumber: 99,
      codeChanges: [{ filePath: 'file.ts', content: 'test', action: 'create' }],
    });

    await applyAndPushStep(ctx);

    const commitMsg = mockCommit.mock.calls[0][0] as string;
    expect(commitMsg).toContain('Closes #99');
    expect(commitMsg).toContain('Generated by CodePilot');
  });

  it('should call validateCodeChanges with the code changes', async () => {
    const changes = [{ filePath: 'file.ts', content: 'test', action: 'create' as const }];
    const ctx = makeCtx({ codeChanges: changes });

    await applyAndPushStep(ctx);

    expect(mockValidateCodeChanges).toHaveBeenCalledOnce();
    expect(mockValidateCodeChanges).toHaveBeenCalledWith(changes);
  });

  it('should abort when validateCodeChanges throws', async () => {
    mockValidateCodeChanges.mockImplementationOnce(() => {
      throw new Error('Dangerous patterns detected');
    });

    const ctx = makeCtx({
      codeChanges: [{ filePath: 'file.ts', content: 'eval("bad")', action: 'create' }],
    });

    await expect(applyAndPushStep(ctx)).rejects.toThrow('Dangerous patterns detected');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('should skip symbolic link files', async () => {
    // Create a real file and a symlink pointing to it
    const realFile = path.join(tmpDir, 'real.ts');
    const symlinkFile = path.join(tmpDir, 'link.ts');
    await fs.writeFile(realFile, 'original content');
    await fs.symlink(realFile, symlinkFile);

    const ctx = makeCtx({
      codeChanges: [
        { filePath: 'link.ts', content: 'overwrite attempt', action: 'create' },
        { filePath: 'safe.ts', content: 'safe content', action: 'create' },
      ],
    });

    await applyAndPushStep(ctx);

    // Symlink target must not be overwritten
    const realContent = await fs.readFile(realFile, 'utf-8');
    expect(realContent).toBe('original content');

    // Non-symlink file must be written normally
    const safeContent = await fs.readFile(path.join(tmpDir, 'safe.ts'), 'utf-8');
    expect(safeContent).toBe('safe content');
  });
});
