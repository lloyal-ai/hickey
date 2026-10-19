/**
 * The acceptance gate, for the command line and for anything else that holds a commit: a change is judged over
 * its whole delta against the principles, and gets in only when the whole with it makes more sense than it does
 * today. `gate` judges a scope asked for by name. `committing` is the commit's own question, from `pre-commit`:
 * the verdict the record already holds for what is being committed, or the staged change judged. `commitRecord`
 * is the one reading of the record both that question and the message hook compose, so a commit is passed on and
 * annotated from the same answer; the message hook adds only what git tells it that `pre-commit` is not told.
 */
import { principlesPath, readConfig, type Config } from './config.js';
import { isEmpty, readDelta, SCOPES, type Delta, type Scope } from './delta.js';
import { exportTree, removeTree, repositoryRoot } from './git.js';
import { CLAUDE, judge, judgeAvailability, JudgeFailed, type Judged, type Spent } from './judge.js';
import { covers, recall, remember } from './record.js';
import type { Verdict } from './verdict.js';

export type { Verdict, Finding, Answer } from './verdict.js';
export type { Config } from './config.js';
export { DEFAULT_PRINCIPLES_PATH, principlesPath } from './config.js';
export type { Delta, Scope } from './delta.js';
export type { Spent } from './judge.js';
export { GitFailed } from './git.js';
export { JudgeFailed } from './judge.js';

export type Outcome =
  | { kind: 'judged'; delta: Delta; verdict: Verdict; spent: Spent }
  /** The verdict the record already holds for what is being committed, which no commit has carried yet: it stands
   *  in place of judging again. */
  | { kind: 'recorded'; delta: Delta; verdict: Verdict }
  /** Nothing was judged: there was no change, or the repository allows a developer without the judge. */
  | { kind: 'skipped'; reason: string };

export function gate(cwd: string, scope: Scope, claude = CLAUDE): Outcome {
  const root = repositoryRoot(cwd);
  return judgeDelta(root, readDelta(root, scope), claude);
}

/** What the record holds for the commit about to be made: which of the deltas a commit carries it is (the record
 *  covers at most one, since their diffs differ), the verdict, and whether a commit already carries it. */
export interface CommitRecord {
  delta: Delta;
  verdict: Verdict;
  carried: boolean;
}

/** The record's reading of the commit about to be made, or null when it covers none of the deltas a commit carries. */
export function commitRecord(cwd: string): CommitRecord | null {
  const root = repositoryRoot(cwd);
  const { last } = recall(root);
  if (last === null) return null;
  const candidates = Object.values(SCOPES).filter((entry) => entry.remembered).flatMap((entry) => entry.parse([]) ?? []);
  const delta = candidates.map((scope) => readDelta(root, scope)).find((candidate) => covers(last, candidate));
  return delta === undefined ? null : { delta, verdict: last.verdict, carried: last.carried };
}

/** The commit's question, from `pre-commit`: what is being committed is passed on the verdict the record already
 *  holds for it when no commit has carried that yet, so a change judged while working, or an amend judged by
 *  `hickey amend`, is not judged again; otherwise the staged change is judged. */
export function committing(cwd: string, claude = CLAUDE): Outcome {
  const root = repositoryRoot(cwd);
  const held = commitRecord(root);
  if (held !== null && !held.carried) return { kind: 'recorded', delta: held.delta, verdict: held.verdict };
  return judgeDelta(root, readDelta(root, { kind: 'staged' }), claude);
}

/** Judges a delta already read, and remembers the verdict when the delta's scope is one a commit carries. */
function judgeDelta(root: string, delta: Delta, claude: string): Outcome {
  const config: Config = readConfig(root);
  if (isEmpty(delta)) return { kind: 'skipped', reason: 'there is no change to judge' };
  const availability = judgeAvailability(claude);
  if (availability.kind !== 'available') {
    if (config.judging === 'when-available') return { kind: 'skipped', reason: `${availability.reason}, so the change was not judged` };
    throw new JudgeFailed(`${availability.reason}, and this repository requires the judge`);
  }
  const { verdict, spent } = judgeInTree(root, delta, config, claude);
  if (SCOPES[delta.scope.kind].remembered) remember(root, delta, verdict);
  return { kind: 'judged', delta, verdict, spent };
}

/** The judge reads the tree the delta names, written out on its own, so what it reads beside the diff is what
 *  the commit would hold and never the working tree's unstaged edits; the working tree itself when the delta is it.
 *  The config and the principles are read from the checkout, not the tree: they bound the judge, they are not the change. */
function judgeInTree(root: string, delta: Delta, config: Config, claude: string): Judged {
  const opts = { principlesPath: principlesPath(root, config), claude };
  if (delta.tree === null) return judge(root, delta, config, opts);
  const tree = exportTree(root, delta.tree);
  try {
    return judge(tree, delta, config, opts);
  } finally {
    removeTree(tree);
  }
}
