/**
 * The record a commit carries, as git trailers in its message: what the gate said about this change, and what it
 * refused before this shape got in. Written by git's own trailer tool from the `prepare-commit-msg` hook, which
 * runs even under `--no-verify`, so an accepted refusal is recorded as what it is. The journal of refusals is
 * cleared only once the commit exists, from `post-commit`.
 */
import type { Delta } from './delta.js';
import { git, lines } from './git.js';
import { changeId, recall, type Recorded } from './record.js';

export interface Trailer {
  token: string;
  value: string;
}

/** The trailer that carries the gate's verdict; the writer and the reader share the one name. */
const GATE = 'Gate';
/** The trailer that counts the refusals an accepted commit left behind. */
const REFUSED_BEFORE = 'Gate-Refused-Before';

/** What the record says about the change being committed. */
type Standing = 'unjudged' | 'in' | 'refused';

function standing(last: Recorded | null, delta: Delta): Standing {
  if (last === null || last.change !== changeId(delta)) return 'unjudged';
  return last.verdict.getsIn ? 'in' : 'refused';
}

const refusedBefore = (refusals: Recorded[]): Trailer[] =>
  refusals.length === 0
    ? []
    : [{ token: REFUSED_BEFORE, value: `${refusals.length}. ${refusals[refusals.length - 1]!.verdict.reason}` }];

const TRAILERS: Record<Standing, (last: Recorded | null, refusals: Recorded[]) => Trailer[]> = {
  unjudged: (_last, refusals) => [{ token: GATE, value: 'not judged as committed' }, ...refusedBefore(refusals)],
  in: (last, refusals) => [{ token: GATE, value: `gets in. ${last!.verdict.reason}` }, ...refusedBefore(refusals)],
  refused: (last, refusals) => {
    const beforeTheAccepted = refusals.slice(0, -1);
    return [{ token: GATE, value: `refused; accepted by the committer. ${last!.verdict.reason}` }, ...refusedBefore(beforeTheAccepted)];
  },
};

/** The trailers for committing `delta`, from what the gate remembers. */
export function trailersFor(root: string, delta: Delta): Trailer[] {
  const { last, refusals } = recall(root);
  return TRAILERS[standing(last, delta)](last, refusals);
}

/** Appends the trailers to the message file in place. */
export function writeTrailers(root: string, messageFile: string, trailers: Trailer[]): void {
  git(root, ['interpret-trailers', '--in-place', ...trailers.flatMap((t) => ['--trailer', `${t.token}: ${t.value}`]), messageFile]);
}

/** One commit of a range and the record its message carries, read by git's own trailer parser. */
export interface Carried {
  commit: string;
  subject: string;
  /** The `Gate` trailer's value, or null when the commit carries none. */
  record: string | null;
}

const FIELD = '\x1f';

/** Every commit in `range` with the record it carries, oldest first. */
export function carried(root: string, range: string): Carried[] {
  const log = git(root, ['log', '--reverse', `--format=%h${FIELD}%s${FIELD}%(trailers:key=${GATE},valueonly,separator=%x20)`, range]);
  return lines(log).map((line) => {
    const [commit = '', subject = '', record = ''] = line.split(FIELD);
    return { commit, subject, record: record.trim() === '' ? null : record.trim() };
  });
}

/** The message sources git names in `prepare-commit-msg` whose message is not a fresh commit's to annotate: a
 *  merge, a squash, and a commit reused or amended, which already carries its record. */
const LEFT_ALONE = new Set(['merge', 'squash', 'commit']);

export const annotates = (source: string | undefined): boolean => source === undefined || !LEFT_ALONE.has(source);
