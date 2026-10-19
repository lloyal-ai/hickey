import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEmpty, isScopeKind, readDelta, SCOPES } from '../src/delta.js';
import { exportTree, GitFailed, gitDir, repositoryRoot } from '../src/git.js';
import { gitIn, repo } from './git.js';

describe('the delta', () => {
  it('reads the staged change and the files it touches', () => {
    const root = repo();
    writeFileSync(join(root, 'a.ts'), 'export const a = 2;\n');
    writeFileSync(join(root, 'b.ts'), 'export const b = 1;\n');
    gitIn(root)('add', 'a.ts', 'b.ts');
    const delta = readDelta(root, { kind: 'staged' });
    expect(delta.files).toEqual(['a.ts', 'b.ts']);
    expect(delta.diff).toContain('+export const a = 2;');
    expect(delta.diff).toContain('+export const b = 1;');
    expect(isEmpty(delta)).toBe(false);
  });

  it('reads the uncommitted changes against the last commit, tracked or not, without touching the index', () => {
    const root = repo();
    writeFileSync(join(root, 'a.ts'), 'export const a = 3;\n');
    writeFileSync(join(root, 'new.ts'), 'export const fresh = true;\n');
    const delta = readDelta(root, { kind: 'uncommitted' });
    expect(delta.files).toEqual(['a.ts', 'new.ts']);
    expect(delta.diff).toContain('+export const a = 3;');
    expect(delta.diff).toContain('+export const fresh = true;');
    const staged = readDelta(root, { kind: 'staged' });
    expect(staged.files).toEqual([]);
    expect(isEmpty(staged)).toBe(true);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toContain('?? new.ts');
  });

  it('reads a range between two commits', () => {
    const root = repo();
    const git = gitIn(root);
    writeFileSync(join(root, 'c.ts'), 'export const c = 1;\n');
    git('add', 'c.ts');
    git('commit', '-q', '-m', 'two');
    const delta = readDelta(root, { kind: 'range', spec: 'HEAD~1...HEAD' });
    expect(delta.files).toEqual(['c.ts']);
    expect(delta.diff).toContain('+export const c = 1;');
  });

  it('reads an amend: the staged change together with the commit it amends, against the parent', () => {
    const root = repo();
    const git = gitIn(root);
    writeFileSync(join(root, 'a.ts'), 'export const a = 2;\n');
    git('add', 'a.ts');
    git('commit', '-q', '-m', 'two');
    writeFileSync(join(root, 'b.ts'), 'export const b = 1;\n');
    git('add', 'b.ts');
    const delta = readDelta(root, { kind: 'amend' });
    expect(delta.files).toEqual(['a.ts', 'b.ts']);
    expect(delta.diff).toContain('+export const a = 2;');
    expect(delta.diff).toContain('+export const b = 1;');
    expect(delta.tree).toBe(git('write-tree').trim());
  });

  it('reads an amend of the first commit against nothing', () => {
    const root = repo();
    writeFileSync(join(root, 'b.ts'), 'export const b = 1;\n');
    gitIn(root)('add', 'b.ts');
    expect(readDelta(root, { kind: 'amend' }).files).toEqual(['a.ts', 'b.ts']);
  });

  it('says which tree the judge reads: the content as it would be committed, or the working tree', () => {
    const root = repo();
    const git = gitIn(root);
    writeFileSync(join(root, 'a.ts'), 'export const a = 2;\n');
    git('add', 'a.ts');
    expect(readDelta(root, { kind: 'staged' }).tree).toBe(git('write-tree').trim());
    expect(readDelta(root, { kind: 'uncommitted' }).tree).toBeNull();
    const head = git('rev-parse', 'HEAD^{tree}').trim();
    expect(readDelta(root, { kind: 'range', spec: 'HEAD~0...HEAD' }).tree).toBe(head);
    expect(readDelta(root, { kind: 'range', spec: 'HEAD~0..' }).tree).toBe(head);
    expect(readDelta(root, { kind: 'range', spec: 'HEAD~0' }).tree).toBeNull();
  });

  it('leaves nothing behind when a tree cannot be exported', () => {
    const root = repo();
    const scratch = mkdtempSync(join(tmpdir(), 'gate-scratch-'));
    const before = process.env.TMPDIR;
    process.env.TMPDIR = scratch;
    try {
      expect(() => exportTree(root, 'not-a-tree')).toThrow(GitFailed);
    } finally {
      if (before === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = before;
    }
    expect(readdirSync(scratch)).toEqual([]);
  });

  it('names every scope in one table: its word, its sentence, whether a commit carries it, how it is parsed and read', () => {
    expect(Object.keys(SCOPES)).toEqual(['staged', 'uncommitted', 'range', 'amend']);
    expect(isScopeKind('range')).toBe(true);
    expect(isScopeKind('worktree')).toBe(false);
    expect(SCOPES.range.parse([])).toBeNull();
    expect(SCOPES.range.parse(['a...b'])).toEqual({ kind: 'range', spec: 'a...b' });
    expect(Object.values(SCOPES).filter((entry) => entry.remembered).map((entry) => entry.sentence)).toEqual([SCOPES.staged.sentence, SCOPES.amend.sentence]);
    for (const entry of Object.values(SCOPES)) expect(entry.usage).toMatch(/^hickey \w+/);
  });

  it('finds the repository root and git directory from inside, and fails loud on a range git cannot read', () => {
    const root = repo();
    expect(repositoryRoot(root)).toBe(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim());
    expect(gitDir(root)).toBe(join(repositoryRoot(root), '.git'));
    expect(() => readDelta(root, { kind: 'range', spec: 'nonexistent...HEAD' })).toThrow(GitFailed);
  });
});
