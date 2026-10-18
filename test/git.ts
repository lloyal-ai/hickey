// A repository to test against: fresh, with one commit, and a git the tests can drive with a fixed author.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const gitIn = (root: string) => (...args: string[]): string =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });

/** A repository whose one commit holds `a.ts`. */
export function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'gate-repo-'));
  const git = gitIn(root);
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
  git('add', 'a.ts');
  git('commit', '-q', '-m', 'one');
  return root;
}

/** That repository with a change to `a.ts` staged. */
export function repoWithStagedChange(): string {
  const root = repo();
  writeFileSync(join(root, 'a.ts'), 'export const a = 2;\n');
  gitIn(root)('add', 'a.ts');
  return root;
}
