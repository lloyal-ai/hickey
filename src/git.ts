/**
 * The one way the gate asks git anything, with one meaning for failure. The index is only ever read, and a
 * tree is only ever written out to a directory of its own for the judge to read.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

/** Where git looks for this checkout's hooks, honouring `core.hooksPath`, as an absolute path. */
export const hooksDir = (root: string): string => resolve(root, git(root, ['rev-parse', '--git-path', 'hooks']).trim());

/** The tree the index holds now: the content a commit made this moment would carry. */
export const indexTree = (root: string): string => git(root, ['write-tree']).trim();

/** What HEAD was made from: its parent, or the tree of no files when HEAD is the first commit. */
export function beforeHead(root: string): string {
  return git(root, ['rev-parse', '--verify', '--quiet', 'HEAD~1'], [0, 1]).trim() || EMPTY_TREE;
}

/** The tree of no files, as git names it. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** The tree a revision names. */
export const treeOf = (root: string, revision: string): string => git(root, ['rev-parse', `${revision}^{tree}`]).trim();

/** Writes `tree` out as files in a fresh directory of its own, for the judge to read as the repository, and says
 *  where. What git exports is the tree and nothing beside it: no untracked or ignored files, and no tracked file
 *  marked `export-ignore` in the attributes, which git leaves out of an archive by its own rule. The
 *  archive git writes is unpacked by tar, the one step here that is not git's, and named as such when it fails. */
export function exportTree(root: string, tree: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hickey-tree-'));
  const archive = `${dir}.tar`;
  try {
    git(root, ['archive', '--format=tar', '-o', archive, tree]);
    const ran = run('tar', ['-xf', archive, '-C', dir]);
    if (ran.error || ran.status !== 0) throw new GitFailed(['archive', tree], `unpacking the archive with tar failed: ${ran.error?.message ?? ran.stderr}`);
    return dir;
  } catch (err) {
    removeTree(dir);
    throw err;
  } finally {
    rmSync(archive, { force: true });
  }
}

/** Removes a directory `exportTree` made. */
export const removeTree = (dir: string): void => rmSync(dir, { recursive: true, force: true });
