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
});
export type Recorded = z.output<typeof Recorded>;

const LAST = 'verdict.json';
const REFUSALS = 'refusals.jsonl';

/** The change as the record keys it. */
export const changeId = (delta: Delta): string => createHash('sha256').update(delta.diff).digest('hex');

/** The gate's own directory inside git's. */
function recordDir(root: string): string {
  const dir = join(gitDir(root), 'gate');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function remember(root: string, delta: Delta, verdict: Verdict): Recorded {
  const recorded: Recorded = { change: changeId(delta), at: new Date().toISOString(), verdict };
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

/** A commit has been made and carries the refusals; the journal starts again. */
export function forgetRefusals(root: string): void {
  writeFileSync(join(recordDir(root), REFUSALS), '');
}

function parseOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
