/**
 * The acceptance gate as one operation, for the command line and for anything else that holds a commit: a
 * change is judged over its whole delta against the principles, and gets in only when the whole with it makes
 * more sense than it does today.
 */
import { principlesPath, readConfig, type Config } from './config.js';
import { isEmpty, readDelta, SCOPES, type Delta, type Scope } from './delta.js';
import { exportTree, removeTree, repositoryRoot } from './git.js';
import { CLAUDE, judge, judgeAvailability, JudgeFailed, type Judged, type Spent } from './judge.js';
import { remember } from './record.js';
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
  /** Nothing was judged: there was no change, or the repository allows a developer without the judge. */
  | { kind: 'skipped'; reason: string };

export function gate(cwd: string, scope: Scope, claude = CLAUDE): Outcome {
  const root = repositoryRoot(cwd);
  const config: Config = readConfig(root);
  const delta: Delta = readDelta(root, scope);
  if (isEmpty(delta)) return { kind: 'skipped', reason: 'there is no change to judge' };
  const availability = judgeAvailability(claude);
  if (availability.kind !== 'available') {
    if (config.judging === 'when-available') return { kind: 'skipped', reason: `${availability.reason}, so the change was not judged` };
    throw new JudgeFailed(`${availability.reason}, and this repository requires the judge`);
  }
  const { verdict, spent } = judgeInTree(root, delta, config, claude);
  if (SCOPES[scope.kind].remembered) remember(root, delta, verdict);
  return { kind: 'judged', delta, verdict, spent };
}

/** The judge reads the tree the delta names, written out on its own, so what it reads beside the diff is what
 *  the commit would hold and never the working tree's unstaged edits; the working tree itself when the delta is it. */
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
