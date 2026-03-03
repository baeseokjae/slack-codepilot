import { describe, expect, it } from 'vitest';
import type { CodeChange } from '../types/index.js';
import { validateCodeChanges } from './code-validator.js';

describe('validateCodeChanges', () => {
  it('delete action은 검증 스킵: content에 위험 패턴이 있어도 통과', () => {
    const changes: CodeChange[] = [
      { filePath: 'src/bad.ts', content: 'eval("rm -rf /")', action: 'delete' },
    ];

    expect(() => validateCodeChanges(changes)).not.toThrow();
  });

  it('안전한 코드는 통과', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/safe.ts',
        content: 'export function add(a: number, b: number): number { return a + b; }',
        action: 'create',
      },
    ];

    expect(() => validateCodeChanges(changes)).not.toThrow();
  });

  it('eval() 포함 코드 → throw', () => {
    const changes: CodeChange[] = [
      { filePath: 'src/evil.ts', content: 'eval("doSomething()")', action: 'create' },
    ];

    expect(() => validateCodeChanges(changes)).toThrow(/eval\(\)/);
    expect(() => validateCodeChanges(changes)).toThrow(/src\/evil\.ts/);
  });

  it('rm -rf / 포함 코드 → throw', () => {
    const changes: CodeChange[] = [
      { filePath: 'src/danger.sh', content: 'rm -rf /tmp/something', action: 'update' },
    ];

    expect(() => validateCodeChanges(changes)).toThrow(/rm -rf \//);
    expect(() => validateCodeChanges(changes)).toThrow(/src\/danger\.sh/);
  });

  it('process.env 포함 코드 → throw', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/config.ts',
        content: 'const secret = process.env.SECRET_KEY;',
        action: 'create',
      },
    ];

    expect(() => validateCodeChanges(changes)).toThrow(/process\.env access/);
    expect(() => validateCodeChanges(changes)).toThrow(/src\/config\.ts/);
  });

  it('child_process 포함 코드 → throw', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/runner.ts',
        content: 'import { exec } from "child_process";',
        action: 'create',
      },
    ];

    expect(() => validateCodeChanges(changes)).toThrow(/child_process/);
    expect(() => validateCodeChanges(changes)).toThrow(/src\/runner\.ts/);
  });

  it('new Function() 포함 코드 → throw', () => {
    const changes: CodeChange[] = [
      {
        filePath: 'src/dynamic.ts',
        content: 'const fn = new Function("return 1");',
        action: 'update',
      },
    ];

    expect(() => validateCodeChanges(changes)).toThrow(/Function constructor/);
    expect(() => validateCodeChanges(changes)).toThrow(/src\/dynamic\.ts/);
  });

  it('여러 파일에 위반이 있으면 모든 위반이 에러 메시지에 포함', () => {
    const changes: CodeChange[] = [
      { filePath: 'src/a.ts', content: 'eval("hack")', action: 'create' },
      { filePath: 'src/b.ts', content: 'const val = process.env.TOKEN;', action: 'update' },
    ];

    let errorMessage = '';
    try {
      validateCodeChanges(changes);
    } catch (err) {
      if (err instanceof Error) {
        errorMessage = err.message;
      }
    }

    expect(errorMessage).toContain('src/a.ts');
    expect(errorMessage).toContain('eval()');
    expect(errorMessage).toContain('src/b.ts');
    expect(errorMessage).toContain('process.env access');
  });
});
