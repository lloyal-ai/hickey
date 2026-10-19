/**
 * The record a commit carries, as git trailers in its message: what the gate said about this change, and what it
 * refused before this shape got in. Written by git's own trailer tool from the `prepare-commit-msg` hook, which
 * runs even under `--no-verify`, so an accepted refusal is recorded as what it is. The journal of refusals is
 * cleared only once the commit exists, from `post-commit`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { git, lines } from './git.js';
import type { CommitRecord, Recorded } from './record.js';
import type { Verdict } from './verdict.js';

/** The trailer that carries the gate's verdict; the writer and the reader share the one name. */
const GATE = 'Gate';
/** The trailer that counts the refusals an accepted commit left behind. Its token shares no prefix with `Gate`:
 *  git's trailer tool matches a token by the shorter of the two names, so `Gate-Refused-Before` and `Gate` would
 *  be one token to it and replacing either would replace both. */
const REFUSED_BEFORE = 'Refused-Before';

/** The record a commit carries: the gate's word on it, and the refusals on the way to it when there were any. */
export interface GateRecord {
  gate: string;
  refusedBefore: string | null;
}

const NOT_JUDGED = 'not judged: no verdict exists for the change as committed';

/** How many refusals the committed shape took to reach, and the last one's reason. */
function refusedBefore(refusals: Recorded[]): string | null {
  if (refusals.length === 0) return null;
  const count = refusals.length === 1 ? '1 refusal' : `${refusals.length} refusals`;
  return `${count} on the way to this shape. Last: ${refusals[refusals.length - 1]!.verdict.reason}`;
}

/** The record for a commit: what the gate said about it, or that it said nothing, and the refusals on the way. An
 *  accepted refusal counts only the refusals before it. */
export function gateRecord(verdict: Verdict | null, refusals: Recorded[]): GateRecord {
  if (verdict === null) return { gate: NOT_JUDGED, refusedBefore: refusedBefore(refusals) };
  if (verdict.getsIn) return { gate: `gets in. ${verdict.reason}`, refusedBefore: refusedBefore(refusals) };
  return { gate: `refused; accepted by the committer. ${verdict.reason}`, refusedBefore: refusedBefore(refusals.slice(0, -1)) };
}

/** The token the refusal count carried before `Refused-Before`; a message from then is normalised when rewritten. */
const LEGACY_REFUSED_BEFORE = 'Gate-Refused-Before';
const OURS = new Set([GATE, REFUSED_BEFORE, LEGACY_REFUSED_BEFORE]);

const FIELD = '\x1f';

/** The tokens of ours a message carries, read by git's trailer parser. */
function oursIn(root: string, messageFile: string): string[] {
  return lines(git(root, ['interpret-trailers', '--parse', messageFile]))
    .map((line) => line.slice(0, line.indexOf(':')).trim())
    .filter((token) => OURS.has(token));
}

/** Writes the record into the message file in place, as one unit. Whatever of ours the message carries, in this
 *  format or the earlier one, is removed first, one trailer at a time because git's trailer tool matches a token by
 *  the shorter name and replaces only the last match; then the record is added. Git trims every empty trailer in
 *  the message to do the removing, and leaves a blank line where the block was, which is folded into the one
 *  blank line a message ends with. */
export function writeTrailers(root: string, messageFile: string, record: GateRecord): void {
  for (let ours = oursIn(root, messageFile); ours.length > 0; ours = oursIn(root, messageFile)) {
    git(root, ['interpret-trailers', '--in-place', '--if-exists', 'replace', '--trim-empty', '--trailer', `${ours[ours.length - 1]}:`, messageFile]);
  }
  const refused = record.refusedBefore === null ? [] : ['--trailer', `${REFUSED_BEFORE}: ${record.refusedBefore}`];
  git(root, ['interpret-trailers', '--in-place', '--trailer', `${GATE}: ${record.gate}`, ...refused, messageFile]);
  writeFileSync(messageFile, readFileSync(messageFile, 'utf8').replace(/\n+$/, '\n'));
}

/** The record HEAD carries, read by git's own trailer parser; `gate` is null when HEAD carries none, or there is no HEAD. */
export function headRecord(root: string): { gate: string | null; refusedBefore: string | null } {
  const log = git(root, ['log', '-1', `--format=%(trailers:key=${GATE},valueonly,separator=%x20)${FIELD}%(trailers:key=${REFUSED_BEFORE},valueonly,separator=%x20)`], [0, 128]);
  const [gate = '', refusedBefore = ''] = log.trim().split(FIELD);
  return { gate: gate.trim() || null, refusedBefore: refusedBefore.trim() || null };
}

/** One commit of a range and the record its message carries, read by git's own trailer parser. */
export interface Carried {
  commit: string;
  subject: string;
  /** The `Gate` trailer's value, or null when the commit carries none. */
  record: string | null;
}

/** Every commit in `range` with the record it carries, oldest first. Merges are left out: `prepare-commit-msg`
 *  never annotates one (see `messageRecord`), so a merge carries no record by design and is not a commit the gate missed. */
export function carried(root: string, range: string): Carried[] {
  const log = git(root, ['log', '--reverse', '--no-merges', `--format=%h${FIELD}%s${FIELD}%(trailers:key=${GATE},valueonly,separator=%x20)`, range]);
  return lines(log).map((line) => {
    const [commit = '', subject = '', record = ''] = line.split(FIELD);
    return { commit, subject, record: record.trim() === '' ? null : record.trim() };
  });
}

/** What `prepare-commit-msg` writes into a message: the record's reading of the commit about to be made,
 *  transcribed, with what git tells this hook alone. A merge is left alone; a squash is a commit of the staged
 *  change with a prepared message and is annotated like any commit. A verdict HEAD already carries stands when the
 *  message is HEAD's own, refusals included; when the message is a replacement, the verdict is written into it
 *  with the refusals HEAD's message carried, so a valid record is not lost with the old text. Git names a message
 *  reused from HEAD the same for `--amend` and `-C HEAD`, so on a reused message a verdict on the staged change
 *  alone is not passed off as the commit's: an amend is judged as a whole by `hickey amend`, and without that the
 *  commit says it was not judged. */
export type MessageRecord = { kind: 'leave' } | { kind: 'stands' } | { kind: 'written'; record: GateRecord };

const MERGE = 'merge';
/** The source git names when a message is reused: an amend, or a borrowed message on a fresh commit. */
const REUSED = 'commit';
const NOT_JUDGED_REUSED = 'not judged: amended or reused; no verdict exists for the commit as made';

export function messageRecord(held: CommitRecord | null, refusals: Recorded[], source: string | undefined, head: { refusedBefore: string | null }): MessageRecord {
  if (source === MERGE) return { kind: 'leave' };
  if (source === REUSED && held?.delta.scope.kind === 'staged') return { kind: 'written', record: { ...gateRecord(null, refusals), gate: NOT_JUDGED_REUSED } };
  if (held !== null && held.carried) {
    return source === REUSED ? { kind: 'stands' } : { kind: 'written', record: { gate: gateRecord(held.verdict, []).gate, refusedBefore: head.refusedBefore } };
  }
  return { kind: 'written', record: gateRecord(held?.verdict ?? null, refusals) };
}
