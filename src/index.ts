/**
 * The acceptance gate as one operation, for the command line and for anything else that holds a commit: a
 * change is judged over its whole delta against the principles, and gets in only when the whole with it makes
 * more sense than it does today.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfig, type Config } from './config.js';
import { isEmpty, readDelta, SCOPES, type Delta, type Scope } from './delta.js';
import { repositoryRoot } from './git.js';
import { CLAUDE, judge, judgeAvailability, JudgeFailed } from './judge.js';
import { remember } from './record.js';
import type { Verdict } from './verdict.js';

export type { Verdict, Finding, Answer } from './verdict.js';
export type { Config } from './config.js';
export type { Delta, Scope } from './delta.js';
export { GitFailed } from './git.js';
export { JudgeFailed } from './judge.js';

/** The principles the judge reads: the one document this package ships, for every repository alike. */
export const PRINCIPLES_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'PRINCIPLES.md');

export type Outcome =
  | { kind: 'judged'; delta: Delta; verdict: Verdict }
  /** Nothing was judged: there was no change, or the repository allows a developer without the judge. */
  | { kind: 'skipped'; reason: string };

export function gate(cwd: string, scope: Scope, claude = CLAUDE): Outcome {
  const root = repositoryRoot(cwd);
  const config: Config = readConfig(root);
  const delta: Delta = readDelta(root, scope);
  if (isEmpty(delta)) return { kind: 'skipped', reason: 'there is no change to judge' };
  const availability = judgeAvailability(claude);
  if (availability.kind !== 'available') {
    if (config.eval === 'when-available') return { kind: 'skipped', reason: `${availability.reason}, so the change was not judged` };
    throw new JudgeFailed(`${availability.reason}, and this repository requires the judge`);
  }
  const verdict = judge(root, delta, config, { principlesPath: PRINCIPLES_PATH, claude });
  if (SCOPES[scope.kind].remembered) remember(root, delta, verdict);
  return { kind: 'judged', delta, verdict };
}
