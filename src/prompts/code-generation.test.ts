import { describe, expect, it } from 'vitest';
import { buildCodeGenerationUserPrompt, CODE_GENERATION_SYSTEM_PROMPT } from './code-generation.js';

describe('code-generation prompts', () => {
  describe('CODE_GENERATION_SYSTEM_PROMPT', () => {
    it('should contain JSON format instruction', () => {
      expect(CODE_GENERATION_SYSTEM_PROMPT).toContain('filePath');
      expect(CODE_GENERATION_SYSTEM_PROMPT).toContain('content');
      expect(CODE_GENERATION_SYSTEM_PROMPT).toContain('action');
    });

    it('should mention create, update, delete actions', () => {
      expect(CODE_GENERATION_SYSTEM_PROMPT).toContain('create');
      expect(CODE_GENERATION_SYSTEM_PROMPT).toContain('update');
      expect(CODE_GENERATION_SYSTEM_PROMPT).toContain('delete');
    });

    it('should instruct JSON-only response', () => {
      expect(CODE_GENERATION_SYSTEM_PROMPT).toContain('Respond with valid JSON only');
    });
  });

  describe('buildCodeGenerationUserPrompt', () => {
    it('should include all parameters in output', () => {
      const result = buildCodeGenerationUserPrompt({
        type: 'feature',
        title: '새 기능 추가',
        description: '로그인 기능 구현',
        fileTree: 'src/\n  index.ts',
        fileContents: '### src/index.ts\n```\nconsole.log("hello")\n```',
      });

      expect(result).toContain('feature');
      expect(result).toContain('새 기능 추가');
      expect(result).toContain('로그인 기능 구현');
      expect(result).toContain('src/\n  index.ts');
      expect(result).toContain('console.log("hello")');
    });

    it('should contain task and file tree sections', () => {
      const result = buildCodeGenerationUserPrompt({
        type: 'fix',
        title: 'Bug fix',
        description: 'Fix login',
        fileTree: 'src/',
        fileContents: '',
      });

      expect(result).toContain('## Task');
      expect(result).toContain('## Repository File Tree');
      expect(result).toContain('## Relevant File Contents');
      expect(result).toContain('CodeChange');
    });
  });
});
