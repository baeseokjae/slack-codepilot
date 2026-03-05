import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config/index.js';
import { createLogger } from '../../lib/logger.js';
import {
  buildCodeGenerationUserPrompt,
  CODE_GENERATION_SYSTEM_PROMPT,
} from '../../prompts/code-generation.js';
import { chatCompletion } from '../../services/ai.service.js';
import type { CodeChange, ConversationMessage } from '../../types/index.js';
import type { PipelineContext } from '../types.js';

const logger = createLogger('step:generate-code');

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', '__pycache__']);
const MAX_FILE_SIZE = 50_000;
const MAX_FILES_TO_READ = 30;
const MAX_CONVERSATION_CHARS = 4000;

async function buildFileTree(dir: string, prefix = ''): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const lines: string[] = [];

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      lines.push(`${relativePath}/`);
      lines.push(await buildFileTree(path.join(dir, entry.name), relativePath));
    } else {
      lines.push(relativePath);
    }
  }

  return lines.filter(Boolean).join('\n');
}

async function readRelevantFiles(dir: string): Promise<string> {
  const results: string[] = [];
  let count = 0;

  async function walk(currentDir: string, prefix: string): Promise<void> {
    if (count >= MAX_FILES_TO_READ) return;
    const items = await fs.readdir(currentDir, { withFileTypes: true });

    for (const item of items) {
      if (count >= MAX_FILES_TO_READ) return;
      if (IGNORE_DIRS.has(item.name)) continue;
      if (item.name.startsWith('.')) continue;

      const fullPath = path.join(currentDir, item.name);
      const relativePath = prefix ? `${prefix}/${item.name}` : item.name;

      if (item.isDirectory()) {
        await walk(fullPath, relativePath);
      } else {
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;

        const content = await fs.readFile(fullPath, 'utf-8');
        results.push(`### ${relativePath}\n\`\`\`\n${content}\n\`\`\``);
        count++;
      }
    }
  }

  await walk(dir, '');
  return results.join('\n\n');
}

/**
 * Escape literal control characters (newlines, tabs, etc.) inside JSON string values.
 * Walks the raw text char-by-char, tracking whether we're inside a quoted string.
 */
function repairJsonStrings(raw: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }

    result += ch;
  }

  return result;
}

export async function generateCodeStep(ctx: PipelineContext): Promise<void> {
  if (!ctx.workspacePath) {
    throw new Error('workspacePath is required for generate-code step');
  }

  logger.info('Building file tree and reading repository contents');

  // Trim conversation history to fit within token budget
  let trimmedHistory: ConversationMessage[] | undefined;
  if (ctx.conversationHistory?.length) {
    trimmedHistory = [...ctx.conversationHistory];
    let totalChars = trimmedHistory.reduce((sum, m) => sum + m.content.length, 0);
    while (totalChars > MAX_CONVERSATION_CHARS && trimmedHistory.length > 1) {
      const removed = trimmedHistory.shift()!;
      totalChars -= removed.content.length;
    }
    logger.info({ messageCount: trimmedHistory.length, totalChars }, 'Conversation history included');
  } else {
    logger.warn('No conversation history available for code generation');
  }

  const fileTree = await buildFileTree(ctx.workspacePath);
  const fileContents = await readRelevantFiles(ctx.workspacePath);

  const userPrompt = buildCodeGenerationUserPrompt({
    type: ctx.request.type,
    title: ctx.request.title,
    description: ctx.request.description,
    fileTree,
    fileContents,
    conversationHistory: trimmedHistory,
  });

  logger.info({ promptLength: userPrompt.length }, 'Sending code generation request to AI');

  const response = await chatCompletion(
    [
      { role: 'system', content: CODE_GENERATION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    { maxTokens: config.CODE_GEN_MAX_TOKENS, temperature: 0.1 },
  );

  const cleaned = response
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  let changes: CodeChange[];
  try {
    changes = JSON.parse(cleaned) as CodeChange[];
  } catch {
    // AI often outputs literal newlines/tabs inside JSON string values — repair and retry
    try {
      changes = JSON.parse(repairJsonStrings(cleaned)) as CodeChange[];
      logger.warn('AI response required JSON repair (unescaped control chars in strings)');
    } catch {
      logger.error({ raw: cleaned.slice(0, 500) }, 'AI returned invalid JSON for code changes');
      throw new Error('AI returned invalid JSON for code changes');
    }
  }

  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error('AI returned empty or invalid code changes array');
  }

  ctx.codeChanges = changes;
  logger.info({ changeCount: changes.length }, 'Code changes generated');
}
