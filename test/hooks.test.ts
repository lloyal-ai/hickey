import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hooksWarning } from '../src/hooks.js';
import { repo } from './git.js';

const LEFTHOOK = 'pre-commit:\n  commands:\n    hickey:\n      run: npx hickey staged\n';

describe('the hooks warning', () => {
  it('says nothing in a repository that never asked for hickey', () => {
    expect(hooksWarning(repo())).toBeNull();
  });

  it('warns when lefthook.yml names hickey and no hook is installed', () => {
    const root = repo();
    writeFileSync(join(root, 'lefthook.yml'), LEFTHOOK);
    expect(hooksWarning(root)).toMatch(/no hook is installed.*npx lefthook install/);
  });

  it('says nothing once lefthook has installed the hook', () => {
    const root = repo();
    writeFileSync(join(root, 'lefthook.yml'), LEFTHOOK);
    mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\ncall_lefthook "$@"\n');
    expect(hooksWarning(root)).toBeNull();
  });
});
