import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE } from '../src/config.js';
import { committing, gate, recordCarried, recordForMessage } from '../src/index.js';
import { carriedByCommit, recall } from '../src/record.js';
import { writeTrailers } from '../src/trailer.js';
import { gitIn, repo, repoWithStagedChange } from './git.js';

const fakeClaude = join(fileURLToPath(new URL('.', import.meta.url)), 'fake-claude.mjs');

/** What the stand-in judge saw of `a.ts` and where it ran, for one gate call. */
function judgeSees(run: () => unknown): { cwd: string; read: string | null } {
  const record = join(mkdtempSync(join(tmpdir(), 'gate-')), 'record.json');
  process.env.FAKE_CLAUDE_RECORD = record;
  process.env.FAKE_CLAUDE_READ = 'a.ts';
  try { run(); } finally { delete process.env.FAKE_CLAUDE_RECORD; delete process.env.FAKE_CLAUDE_READ; }
  return JSON.parse(readFileSync(record, 'utf8')) as { cwd: string; read: string | null };
}

/** The message hook's record for the commit about to be made. */
const message = (root: string, source: string | undefined) => recordForMessage(root, source);

/** A repository whose last commit was judged, carries its record, and has told the record so: the hook path of
 *  a fresh commit, from the staged change `a = 2`. */
function judgedCommit(): string {
  const root = repoWithStagedChange();
  committing(root, fakeClaude);
  const messageFile = join(root, 'MSG');
  writeFileSync(messageFile, 'two\n');
  const record = message(root, undefined);
  if (record.kind !== 'written') throw new Error('expected a written record');
  writeTrailers(root, messageFile, record.record);
  gitIn(root)('commit', '-q', '-F', messageFile);
  recordCarried(root);
  return root;
}

const IN = { gate: 'gets in. The whole has one reading where it had one before.', refusedBefore: null };

describe("the commit's question", () => {
  it('is answered by the verdict already recorded for the staged change, until a commit carries it', () => {
    const root = repoWithStagedChange();
    expect(gate(root, { kind: 'staged' }, fakeClaude).kind).toBe('judged');
    expect(gate(root, { kind: 'staged' }, fakeClaude).kind).toBe('judged');
    expect(committing(root, fakeClaude)).toMatchObject({ kind: 'recorded', delta: { scope: { kind: 'staged' } } });
    expect(message(root, undefined)).toEqual({ kind: 'written', record: IN });
    carriedByCommit(root);
    writeFileSync(join(root, 'a.ts'), 'export const a = 7;\n');
    gitIn(root)('add', 'a.ts');
    expect(committing(root, fakeClaude).kind).toBe('judged');
  });

  it('on a message-only amend leaves the record the commit carries, refusals included', () => {
    const root = judgedCommit();
    expect(message(root, 'commit')).toEqual({ kind: 'stands' });
  });

  it('on an amend judged by hickey amend is that verdict, taken by pre-commit and written by the message hook', () => {
    const root = judgedCommit();
    writeFileSync(join(root, 'b.ts'), 'export const b = 1;\n');
    gitIn(root)('add', 'b.ts');
    expect(gate(root, { kind: 'amend' }, fakeClaude)).toMatchObject({ kind: 'judged', delta: { scope: { kind: 'amend' }, files: ['a.ts', 'b.ts'] } });
    expect(committing(root, fakeClaude)).toMatchObject({ kind: 'recorded', delta: { scope: { kind: 'amend' } } });
    expect(message(root, 'commit')).toEqual({ kind: 'written', record: IN });
  });

  it('on an amend without hickey amend judges the increment, and the commit says it was not judged as made', () => {
    const root = judgedCommit();
    writeFileSync(join(root, 'b.ts'), 'export const b = 1;\n');
    gitIn(root)('add', 'b.ts');
    expect(committing(root, fakeClaude).kind).toBe('judged');
    expect(message(root, 'commit')).toEqual({ kind: 'written', record: { gate: 'not judged: amended or reused; no verdict exists for the commit as made', refusedBefore: null } });
  });

  it('on an amend hickey amend refused blocks pre-commit, and under --no-verify is the accepted refusal', () => {
    const root = judgedCommit();
    writeFileSync(join(root, 'b.ts'), 'export const b = 1;\n');
    gitIn(root)('add', 'b.ts');
    process.env.FAKE_CLAUDE_MODE = 'refused';
    try { gate(root, { kind: 'amend' }, fakeClaude); } finally { delete process.env.FAKE_CLAUDE_MODE; }
    expect(committing(root, fakeClaude)).toMatchObject({ kind: 'recorded', verdict: { getsIn: false } });
    const record = message(root, 'commit');
    if (record.kind !== 'written') throw new Error('expected a written record');
    expect(record.record.gate).toBe('refused; accepted by the committer. A second reading of the record.');
  });

  it('is judged again when the same patch is staged in a different tree', () => {
    const root = repo();
    const git = gitIn(root);
    git('checkout', '-q', '-b', 'other');
    writeFileSync(join(root, 'lifecycle.ts'), 'export const owner = "pool";\n');
    git('add', 'lifecycle.ts');
    git('commit', '-q', '-m', 'lifecycle');
    git('checkout', '-q', 'main');
    writeFileSync(join(root, 'a.ts'), 'export const a = 2;\n');
    git('add', 'a.ts');
    expect(committing(root, fakeClaude).kind).toBe('judged');
    expect(committing(root, fakeClaude).kind).toBe('recorded');
    git('checkout', '-q', 'other');
    expect(committing(root, fakeClaude).kind).toBe('judged');
  });

  it('is judged again when the principles changed since the verdict', () => {
    const root = repoWithStagedChange();
    expect(committing(root, fakeClaude).kind).toBe('judged');
    writeFileSync(join(root, 'PRINCIPLES.md'), '# Ours\n');
    writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ principles: 'PRINCIPLES.md' }));
    expect(committing(root, fakeClaude).kind).toBe('judged');
  });

  it('leaves a merge message alone and annotates a squash like any commit', () => {
    const root = judgedCommit();
    expect(message(root, 'merge')).toEqual({ kind: 'leave' });
    writeFileSync(join(root, 'b.ts'), 'export const b = 1;\n');
    gitIn(root)('add', 'b.ts');
    committing(root, fakeClaude);
    expect(message(root, 'squash')).toEqual({ kind: 'written', record: IN });
  });

  it('marks the verdict carried only when the commit made carries the record', () => {
    const root = repoWithStagedChange();
    committing(root, fakeClaude);
    gitIn(root)('commit', '-q', '-m', 'two, unannotated');
    recordCarried(root);
    expect(recall(root).last?.carried).toBe(false);
  });

  it('writes a still-valid record into a replacement message on a message-only --amend -m, refusals carried over', () => {
    const root = repoWithStagedChange();
    process.env.FAKE_CLAUDE_MODE = 'refused';
    try { gate(root, { kind: 'staged' }, fakeClaude); } finally { delete process.env.FAKE_CLAUDE_MODE; }
    gate(root, { kind: 'staged' }, fakeClaude);
    const messageFile = join(root, 'MSG');
    writeFileSync(messageFile, 'two\n');
    const first = message(root, undefined);
    if (first.kind !== 'written') throw new Error('expected a written record');
    writeTrailers(root, messageFile, first.record);
    gitIn(root)('commit', '-q', '-F', messageFile);
    recordCarried(root);
    expect(message(root, 'commit')).toEqual({ kind: 'stands' });
    expect(message(root, 'message')).toEqual({ kind: 'written', record: { gate: IN.gate, refusedBefore: '1 refusal on the way to this shape. Last: A second reading of the record.' } });
  });
});

describe('the gate as one operation', () => {
  it('judges a staged change and remembers the verdict for the commit to carry', () => {
    const root = repoWithStagedChange();
    const outcome = gate(root, { kind: 'staged' }, fakeClaude);
    expect(outcome.kind).toBe('judged');
    if (outcome.kind !== 'judged') return;
    expect(outcome.verdict.getsIn).toBe(true);
    expect(outcome.delta.files).toEqual(['a.ts']);
    expect(recall(root).last?.verdict).toEqual(outcome.verdict);
  });

  it('judges the uncommitted changes without remembering them: that verdict is not the one a commit carries', () => {
    const root = repo();
    writeFileSync(join(root, 'a.ts'), 'export const a = 5;\n');
    const outcome = gate(root, { kind: 'uncommitted' }, fakeClaude);
    expect(outcome.kind).toBe('judged');
    expect(recall(root).last).toBeNull();
  });

  it('gives the judge the change as it would be committed, never the working tree beside it', () => {
    const root = repoWithStagedChange();
    writeFileSync(join(root, 'a.ts'), 'export const a = 3;\n');
    const seen = judgeSees(() => gate(root, { kind: 'staged' }, fakeClaude));
    expect(seen.read).toBe('export const a = 2;\n');
    expect(seen.cwd).not.toBe(realpathSync(root));
    expect(existsSync(seen.cwd)).toBe(false);
  });

  it('gives the judge the working tree itself for the uncommitted changes', () => {
    const root = repo();
    writeFileSync(join(root, 'a.ts'), 'export const a = 5;\n');
    const seen = judgeSees(() => gate(root, { kind: 'uncommitted' }, fakeClaude));
    expect(seen.read).toBe('export const a = 5;\n');
    expect(realpathSync(seen.cwd)).toBe(realpathSync(root));
  });

  it('judges nothing when there is no change', () => {
    expect(gate(repo(), { kind: 'staged' }, fakeClaude)).toEqual({ kind: 'skipped', reason: 'there is no change to judge' });
  });

  it('skips a missing judge only where the repository allows it, and refuses where it requires one', () => {
    const allowed = repoWithStagedChange();
    expect(gate(allowed, { kind: 'staged' }, '/nonexistent/claude')).toMatchObject({ kind: 'skipped' });
    const required = repoWithStagedChange();
    writeFileSync(join(required, CONFIG_FILE), JSON.stringify({ kind: 'framework', judging: 'required' }));
    expect(() => gate(required, { kind: 'staged' }, '/nonexistent/claude')).toThrow(/requires the judge/);
  });
});
