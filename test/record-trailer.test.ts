import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDelta } from '../src/delta.js';
import { commitRecord } from '../src/index.js';
import { carriedByCommit, changeId, recall, remember, type Recorded } from '../src/record.js';
import { carried, gateRecord, writeTrailers } from '../src/trailer.js';
import type { Verdict } from '../src/verdict.js';
import { gitIn, repoWithStagedChange } from './git.js';

const verdict = (getsIn: boolean, reason: string): Verdict => ({
  wholeToday: 'today', wholeWithChange: 'after', answers: [], shape: 'one reader', getsIn, reason,
});

describe('the record', () => {
  it('remembers the last verdict keyed by the change, and journals refusals', () => {
    const root = repoWithStagedChange();
    const delta = readDelta(root, { kind: 'staged' });
    expect(recall(root)).toEqual({ last: null, refusals: [] });
    remember(root, delta, verdict(false, 'A second reading.'));
    remember(root, delta, verdict(false, 'Still a second reading.'));
    remember(root, delta, verdict(true, 'One reading.'));
    const { last, refusals } = recall(root);
    expect(last?.change).toBe(changeId(delta));
    expect(last?.verdict.getsIn).toBe(true);
    expect(refusals.map((r) => r.verdict.reason)).toEqual(['A second reading.', 'Still a second reading.']);
    expect(last?.carried).toBe(false);
    carriedByCommit(root);
    expect(recall(root).refusals).toEqual([]);
    expect(recall(root).last?.carried).toBe(true);
  });
});

describe('what the record holds for the commit about to be made', () => {
  it('is nothing when the record covers no delta a commit carries', () => {
    expect(commitRecord(repoWithStagedChange())).toBeNull();
  });

  it('is the staged change with its verdict, uncarried, once judged', () => {
    const root = repoWithStagedChange();
    remember(root, readDelta(root, { kind: 'staged' }), verdict(true, 'One reading.'));
    expect(commitRecord(root)).toMatchObject({ delta: { scope: { kind: 'staged' } }, verdict: { reason: 'One reading.' }, carried: false });
  });

  it('is the commit as amended when the record covers that, carried once the amend is made', () => {
    const root = repoWithStagedChange();
    gitIn(root)('commit', '-q', '-m', 'two');
    writeFileSync(join(root, 'b.ts'), 'export const b = 1;\n');
    gitIn(root)('add', 'b.ts');
    remember(root, readDelta(root, { kind: 'amend' }), verdict(true, 'Whole.'));
    expect(commitRecord(root)).toMatchObject({ delta: { scope: { kind: 'amend' }, files: ['a.ts', 'b.ts'] }, verdict: { reason: 'Whole.' }, carried: false });
    gitIn(root)('commit', '-q', '--amend', '--no-edit');
    carriedByCommit(root);
    expect(commitRecord(root)).toMatchObject({ delta: { scope: { kind: 'amend' } }, verdict: { reason: 'Whole.' }, carried: true });
  });

  it('is nothing again when the staged change differs from the judged one', () => {
    const root = repoWithStagedChange();
    remember(root, readDelta(root, { kind: 'staged' }), verdict(true, 'One reading.'));
    writeFileSync(join(root, 'a.ts'), 'export const a = 3;\n');
    gitIn(root)('add', 'a.ts');
    expect(commitRecord(root)).toBeNull();
  });
});

describe('the record a commit carries', () => {
  const refusals = (...reasons: string[]): Recorded[] => reasons.map((reason) => ({ change: 'x', at: 'now', carried: false, verdict: verdict(false, reason) }));

  it('says the change got in, and how many times it was refused on the way', () => {
    expect(gateRecord(verdict(true, 'One reading.'), refusals('A second reading.'))).toEqual({
      gate: 'gets in. One reading.',
      refusedBefore: '1 refusal on the way to this shape. Last: A second reading.',
    });
  });

  it('says a refusal was accepted by the committer when the commit proceeds anyway, counting only the earlier refusals', () => {
    expect(gateRecord(verdict(false, 'A second reading.'), refusals('A first refusal.', 'A second reading.'))).toEqual({
      gate: 'refused; accepted by the committer. A second reading.',
      refusedBefore: '1 refusal on the way to this shape. Last: A first refusal.',
    });
  });

  it('says the change was not judged when there is no verdict', () => {
    expect(gateRecord(null, [])).toEqual({ gate: 'not judged: no verdict exists for the change as committed', refusedBefore: null });
  });

  it('is written into the message by git as one unit, and the journal waits for the commit to exist', () => {
    const root = repoWithStagedChange();
    const delta = readDelta(root, { kind: 'staged' });
    remember(root, delta, verdict(false, 'A second reading.'));
    remember(root, delta, verdict(true, 'One reading.'));
    const messageFile = join(root, 'COMMIT_EDITMSG');
    writeFileSync(messageFile, 'fix(a): two\n\nThe body.\n');
    writeTrailers(root, messageFile, gateRecord(verdict(true, 'One reading.'), recall(root).refusals));
    const message = readFileSync(messageFile, 'utf8');
    expect(message).toBe('fix(a): two\n\nThe body.\n\nGate: gets in. One reading.\nRefused-Before: 1 refusal on the way to this shape. Last: A second reading.\n');
    expect(recall(root).refusals).toHaveLength(1);
    carriedByCommit(root);
    expect(recall(root).refusals).toEqual([]);
  });

  it('replaces the record a message already carries, removing the token it no longer has', () => {
    const root = repoWithStagedChange();
    const messageFile = join(root, 'MSG');
    writeFileSync(messageFile, 'two\n\nGate: gets in. Old.\nRefused-Before: 2 refusals on the way to this shape. Last: Older.\n');
    writeTrailers(root, messageFile, { gate: 'gets in. New.', refusedBefore: null });
    expect(readFileSync(messageFile, 'utf8')).toBe('two\n\nGate: gets in. New.\n');
  });

  it('leave merge commits out of the range they read, since a merge is never annotated', () => {
    const root = repoWithStagedChange();
    const git = gitIn(root);
    const base = git('rev-parse', 'HEAD').trim();
    remember(root, readDelta(root, { kind: 'staged' }), verdict(true, 'One reading.'));
    const messageFile = join(root, 'MSG');
    writeFileSync(messageFile, 'fix(a): two\n');
    writeTrailers(root, messageFile, gateRecord(verdict(true, 'One reading.'), []));
    git('commit', '-q', '-F', messageFile);
    git('checkout', '-q', '-b', 'side', base);
    writeFileSync(join(root, 'b.ts'), 'export const b = 1;\n');
    git('add', 'b.ts');
    git('commit', '-q', '-m', 'side: b\n\nGate: gets in. Another reading.');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    const commits = carried(root, `${base}...HEAD`);
    expect(commits.map((c) => c.subject).sort()).toEqual(['fix(a): two', 'side: b']);
    expect(commits.every((c) => c.record !== null)).toBe(true);
  });

  it('are read back from a range of commits, so a pull request can be checked without a judge', () => {
    const root = repoWithStagedChange();
    const git = gitIn(root);
    const messageFile = join(root, 'MSG');
    writeFileSync(messageFile, 'fix(a): two\n');
    writeTrailers(root, messageFile, gateRecord(verdict(true, 'One reading.'), []));
    git('commit', '-q', '-F', messageFile);
    writeFileSync(join(root, 'a.ts'), 'export const a = 9;\n');
    git('add', 'a.ts');
    git('commit', '-q', '-m', 'fix(a): three, never judged');
    const commits = carried(root, 'HEAD~2...HEAD');
    expect(commits.map((c) => [c.subject, c.record])).toEqual([
      ['fix(a): two', 'gets in. One reading.'],
      ['fix(a): three, never judged', null],
    ]);
  });
});
