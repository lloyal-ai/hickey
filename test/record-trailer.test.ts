import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDelta } from '../src/delta.js';
import { changeId, forgetRefusals, recall, remember } from '../src/record.js';
import { annotates, trailersFor, writeTrailers } from '../src/trailer.js';
import type { Verdict } from '../src/verdict.js';
import { gitIn, repoWithStagedChange } from './git.js';

const verdict = (getsIn: boolean, reason: string): Verdict => ({
  wholeToday: 'today', wholeWithChange: 'after', answers: [], getsIn, reason,
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
    forgetRefusals(root);
    expect(recall(root).refusals).toEqual([]);
  });
});

describe('the trailers', () => {
  it('say the change got in, and how many times it was refused on the way', () => {
    const root = repoWithStagedChange();
    const delta = readDelta(root, { kind: 'staged' });
    remember(root, delta, verdict(false, 'A second reading.'));
    remember(root, delta, verdict(true, 'One reading.'));
    expect(trailersFor(root, delta)).toEqual([
      { token: 'Gate', value: 'gets in. One reading.' },
      { token: 'Gate-Refused-Before', value: '1. A second reading.' },
    ]);
  });

  it('say a refusal was accepted by the committer when the commit proceeds anyway, counting only the earlier refusals', () => {
    const root = repoWithStagedChange();
    const delta = readDelta(root, { kind: 'staged' });
    remember(root, delta, verdict(false, 'A first refusal.'));
    remember(root, delta, verdict(false, 'A second reading.'));
    expect(trailersFor(root, delta)).toEqual([
      { token: 'Gate', value: 'refused; accepted by the committer. A second reading.' },
      { token: 'Gate-Refused-Before', value: '1. A first refusal.' },
    ]);
  });

  it('say the change was not judged as committed when the staged change differs from the judged one', () => {
    const root = repoWithStagedChange();
    const delta = readDelta(root, { kind: 'staged' });
    remember(root, delta, verdict(true, 'One reading.'));
    writeFileSync(join(root, 'a.ts'), 'export const a = 3;\n');
    gitIn(root)('add', 'a.ts');
    expect(trailersFor(root, readDelta(root, { kind: 'staged' }))).toEqual([{ token: 'Gate', value: 'not judged as committed' }]);
  });

  it('are written into the message by git, and the journal waits for the commit to exist', () => {
    const root = repoWithStagedChange();
    const delta = readDelta(root, { kind: 'staged' });
    remember(root, delta, verdict(false, 'A second reading.'));
    remember(root, delta, verdict(true, 'One reading.'));
    const messageFile = join(root, 'COMMIT_EDITMSG');
    writeFileSync(messageFile, 'fix(a): two\n\nThe body.\n');
    writeTrailers(root, messageFile, trailersFor(root, delta));
    const message = readFileSync(messageFile, 'utf8');
    expect(message.startsWith('fix(a): two\n\nThe body.\n')).toBe(true);
    expect(message).toContain('Gate: gets in. One reading.');
    expect(message).toContain('Gate-Refused-Before: 1. A second reading.');
    expect(recall(root).refusals).toHaveLength(1);
    forgetRefusals(root);
    expect(recall(root).refusals).toEqual([]);
  });

  it('leave merge, squash and reused or amended messages alone', () => {
    expect(annotates(undefined)).toBe(true);
    expect(annotates('message')).toBe(true);
    expect(annotates('template')).toBe(true);
    expect(annotates('merge')).toBe(false);
    expect(annotates('squash')).toBe(false);
    expect(annotates('commit')).toBe(false);
  });
});
