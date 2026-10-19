/**
 * What the gate remembers between judging a change and committing it, kept in the repository's git directory
 * and never in the tree: the last verdict, keyed by the change it was about, and every refusal since the last
 * accepted commit, so the commit that finally gets in can carry the journey that produced its shape.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Delta } from './delta.js';
import { gitDir } from './git.js';
import { Verdict } from './verdict.js';

export const Recorded = z.object({
  /** The change the verdict was about: a digest of its diff. */
  change: z.string(),
  at: z.string(),
  verdict: Verdict,
  /** Whether a commit has been made that carries this verdict, set from `post-commit`. A verdict carried by HEAD
   *  is HEAD's own record; one not yet carried is waiting for the commit it describes. */
  carried: z.boolean().default(false),
});
export type Recorded = z.output<typeof Recorded>;

const LAST = 'verdict.json';
const REFUSALS = 'refusals.jsonl';

/** The change as the record keys it: the diff, the tree it was judged in, and the principles it was judged by.
 *  The same patch belongs in one surrounding system and not another, and a verdict is only ever about the inputs
 *  the judge had, so a verdict keyed by the diff alone would be reused where it does not apply. */
export function changeId(delta: Delta, principles: string): string {
  return createHash('sha256').update(delta.diff).update('\0').update(delta.tree ?? '').update('\0').update(principles).digest('hex');
}

/** Whether a recorded verdict is about `delta`, judged by `principles`. */
export const covers = (recorded: Recorded | null, delta: Delta, principles: string): recorded is Recorded =>
  recorded !== null && recorded.change === changeId(delta, principles);

/** What the record holds for the commit about to be made: which of the deltas a commit carries it is (the record
 *  covers at most one, since their diffs differ), the verdict, and whether a commit already carries it. */
export interface CommitRecord {
  delta: Delta;
  verdict: Verdict;
  carried: boolean;
}

/** The gate's own directory inside git's. */
function recordDir(root: string): string {
  const dir = join(gitDir(root), 'hickey');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function remember(root: string, delta: Delta, verdict: Verdict, principles: string): Recorded {
  const recorded: Recorded = { change: changeId(delta, principles), at: new Date().toISOString(), verdict, carried: false };
  const dir = recordDir(root);
  writeFileSync(join(dir, LAST), JSON.stringify(recorded));
  if (!verdict.getsIn) appendFileSync(join(dir, REFUSALS), `${JSON.stringify(recorded)}\n`);
  return recorded;
}

export interface Recalled {
  /** The last verdict, whatever change it was about. */
  last: Recorded | null;
  /** Every refusal since the journal was last cleared, oldest first. */
  refusals: Recorded[];
}

const readOr = (file: string, absent: string): string => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return absent;
  }
};

export function recall(root: string): Recalled {
  const dir = recordDir(root);
  const last = Recorded.safeParse(parseOrNull(readOr(join(dir, LAST), 'null')));
  const refusals = readOr(join(dir, REFUSALS), '')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => Recorded.safeParse(parseOrNull(line)))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  return { last: last.success ? last.data : null, refusals };
}

/** A commit has been made: it carries the last verdict and the refusals, so the verdict is marked carried and the
 *  journal starts again. */
export function carriedByCommit(root: string): void {
  const dir = recordDir(root);
  const { last } = recall(root);
  if (last !== null) writeFileSync(join(dir, LAST), JSON.stringify({ ...last, carried: true }));
  writeFileSync(join(dir, REFUSALS), '');
}

function parseOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
