import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/index.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    GIT_WORKSPACE_DIR: '/tmp/codepilot-workspaces',
  },
}));

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(),
}));

vi.mock('../../services/github.service.js', () => ({
  getAuthenticatedCloneUrl: vi.fn(),
}));

import { generateBranchName } from './clone-repo.js';

describe('clone-repo', () => {
  describe('generateBranchName', () => {
    it('should create branch name with type and slug', () => {
      const result = generateBranchName('feature', 'Add login page');
      expect(result).toBe('codepilot/feature/add-login-page');
    });

    it('should handle Korean titles', () => {
      const result = generateBranchName('fix', '로그인 버그 수정');
      expect(result).toBe('codepilot/fix/로그인-버그-수정');
    });

    it('should truncate long slugs to 40 characters', () => {
      const longTitle = 'a'.repeat(60);
      const result = generateBranchName('feature', longTitle);
      const slug = result.replace('codepilot/feature/', '');
      expect(slug.length).toBeLessThanOrEqual(40);
    });

    it('should strip special characters', () => {
      const result = generateBranchName('fix', 'Fix: login@page! #123');
      expect(result).toBe('codepilot/fix/fix-login-page-123');
    });

    it('should fallback to "task" when slug is empty', () => {
      const result = generateBranchName('feature', '!!!@@@###');
      expect(result).toBe('codepilot/feature/task');
    });

    it('should strip leading and trailing hyphens', () => {
      const result = generateBranchName('feature', '---test---');
      expect(result).toBe('codepilot/feature/test');
    });
  });
});
