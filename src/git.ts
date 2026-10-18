/**
 * The one way the gate asks git anything, with one meaning for failure. The index is only ever read.
 */
import { run } from './child.js';

export class GitFailed extends Error {
  constructor(args: readonly string[], detail: string) {
    super(`git ${args.join(' ')} failed: ${detail.trim()}`);
    this.name = 'GitFailed';
  }
}

/** Runs git in `root` and returns what it printed; any exit status not in `okay` is a failure. */
export function git(root: string, args: readonly string[], okay: readonly number[] = [0]): string {
  const ran = run('git', args, { cwd: root });
  if (ran.error) throw new GitFailed(args, ran.error.message);
  if (ran.status === null || !okay.includes(ran.status)) throw new GitFailed(args, ran.stderr);
  return ran.stdout;
}

/** What git printed, as its non-empty lines. */
export const lines = (output: string): string[] => output.split('\n').filter((line) => line.length > 0);

/** The repository root the gate runs in. */
export const repositoryRoot = (cwd: string): string => git(cwd, ['rev-parse', '--show-toplevel']).trim();

/** Where git keeps this checkout's own files, as an absolute path. */
export const gitDir = (root: string): string => git(root, ['rev-parse', '--absolute-git-dir']).trim();
