import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/index.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    CODE_GEN_MAX_TOKENS: 8192,
  },
}));

vi.mock('../../services/ai.service.js', () => ({
  chatCompletion: vi.fn(),
}));

vi.mock('../../prompts/code-generation.js', () => ({
  CODE_GENERATION_SYSTEM_PROMPT: 'system prompt',
  buildCodeGenerationUserPrompt: vi.fn().mockReturnValue('user prompt'),
}));

import { chatCompletion } from '../../services/ai.service.js';
import { buildCodeGenerationUserPrompt } from '../../prompts/code-generation.js';
import type { PipelineContext } from '../types.js';
import { generateCodeStep } from './generate-code.js';

const mockChatCompletion = vi.mocked(chatCompletion);
const mockBuildPrompt = vi.mocked(buildCodeGenerationUserPrompt);

// We need a real filesystem for buildFileTree/readRelevantFiles
// so we mock the workspace to use a temporary directory
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('generateCodeStep', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codepilot-test-'));
    // Create a minimal file structure
    await fs.writeFile(path.join(tmpDir, 'index.ts'), 'console.log("hello");');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
    return {
      jobId: 'job-1',
      correlationId: 'test-correlation-id',
      channelId: 'C123',
      threadTs: 'ts123',
      userId: 'U123',
      request: {
        type: 'feature',
        title: 'Add feature',
        description: 'Add new feature',
        targetRepo: 'owner/repo',
        priority: 'medium',
        confidence: 0.9,
        missingInfo: null,
      },
      workspacePath: tmpDir,
      ...overrides,
    };
  }

  it('should throw when workspacePath is missing', async () => {
    const ctx = makeCtx({ workspacePath: undefined });
    await expect(generateCodeStep(ctx)).rejects.toThrow('workspacePath is required');
  });

  it('should parse valid AI response and set codeChanges', async () => {
    const changes = [
      { filePath: 'src/new-file.ts', content: 'export const x = 1;', action: 'create' },
    ];
    mockChatCompletion.mockResolvedValue(JSON.stringify(changes));

    const ctx = makeCtx();
    await generateCodeStep(ctx);

    expect(ctx.codeChanges).toEqual(changes);
    expect(mockChatCompletion).toHaveBeenCalledOnce();
  });

  it('should strip markdown code fences from AI response', async () => {
    const changes = [{ filePath: 'src/file.ts', content: 'const y = 2;', action: 'update' }];
    mockChatCompletion.mockResolvedValue(`\`\`\`json\n${JSON.stringify(changes)}\n\`\`\``);

    const ctx = makeCtx();
    await generateCodeStep(ctx);

    expect(ctx.codeChanges).toEqual(changes);
  });

  it('should throw on truncated AI response', async () => {
    mockChatCompletion.mockResolvedValue('not valid json at all');

    const ctx = makeCtx();
    await expect(generateCodeStep(ctx)).rejects.toThrow('AI response was truncated');
  });

  it('should throw on invalid JSON that is not truncated', async () => {
    mockChatCompletion.mockResolvedValue('[invalid json content]');

    const ctx = makeCtx();
    await expect(generateCodeStep(ctx)).rejects.toThrow('AI returned invalid JSON');
  });

  it('should throw on empty changes array', async () => {
    mockChatCompletion.mockResolvedValue('[]');

    const ctx = makeCtx();
    await expect(generateCodeStep(ctx)).rejects.toThrow('empty or invalid code changes');
  });

  it('should pass maxTokens from config to chatCompletion', async () => {
    const changes = [{ filePath: 'f.ts', content: 'x', action: 'create' }];
    mockChatCompletion.mockResolvedValue(JSON.stringify(changes));

    const ctx = makeCtx();
    await generateCodeStep(ctx);

    expect(mockChatCompletion.mock.calls[0][1]).toEqual({
      maxTokens: 8192,
      temperature: 0.1,
    });
  });

  it('should pass conversationHistory to buildCodeGenerationUserPrompt', async () => {
    const changes = [{ filePath: 'f.ts', content: 'x', action: 'create' }];
    mockChatCompletion.mockResolvedValue(JSON.stringify(changes));

    const history = [
      { role: 'user' as const, content: 'README 업데이트해줘', timestamp: 'ts1' },
      { role: 'assistant' as const, content: '어떤 내용?', timestamp: 'ts2' },
    ];
    const ctx = makeCtx({ conversationHistory: history });
    await generateCodeStep(ctx);

    expect(mockBuildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ conversationHistory: history }),
    );
  });

  it('should trim conversation history exceeding MAX_CONVERSATION_CHARS', async () => {
    const changes = [{ filePath: 'f.ts', content: 'x', action: 'create' }];
    mockChatCompletion.mockResolvedValue(JSON.stringify(changes));

    // Create messages that exceed 4000 chars total
    const longMsg = 'x'.repeat(3000);
    const history = [
      { role: 'user' as const, content: longMsg, timestamp: 'ts1' },
      { role: 'assistant' as const, content: 'short reply', timestamp: 'ts2' },
      { role: 'user' as const, content: longMsg, timestamp: 'ts3' },
    ];
    const ctx = makeCtx({ conversationHistory: history });
    await generateCodeStep(ctx);

    // The first message should be trimmed to fit within budget
    const passedHistory = mockBuildPrompt.mock.calls[0][0].conversationHistory;
    expect(passedHistory).toBeDefined();
    expect(passedHistory!.length).toBeLessThan(3);
  });

  it('should repair AI response with unescaped newlines in JSON strings', async () => {
    // Simulate AI returning literal newlines inside JSON string values
    const raw = '[\n  {\n    "filePath": "README.md",\n    "content": "# Title\n\nSome text\nAnother line",\n    "action": "create"\n  }\n]';
    mockChatCompletion.mockResolvedValue(raw);

    const ctx = makeCtx();
    await generateCodeStep(ctx);

    expect(ctx.codeChanges).toEqual([
      { filePath: 'README.md', content: '# Title\n\nSome text\nAnother line', action: 'create' },
    ]);
  });

  it('should work without conversationHistory (backward compat)', async () => {
    const changes = [{ filePath: 'f.ts', content: 'x', action: 'create' }];
    mockChatCompletion.mockResolvedValue(JSON.stringify(changes));

    const ctx = makeCtx();
    await generateCodeStep(ctx);

    expect(mockBuildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ conversationHistory: undefined }),
    );
  });
});
