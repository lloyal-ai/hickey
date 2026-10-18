/**
 * One way to run a child process and read what it said. `git.ts` composes it for git and `judge.ts` for the
 * judge; nothing else spawns.
 */
import { spawnSync } from 'node:child_process';

/** The most output read from a child before it is cut off: a large diff, a long verdict. */
const OUTPUT_LIMIT = 64 * 1024 * 1024;

export interface Ran {
  /** Null when the process never started or was killed by a signal. */
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not be started at all. */
  error?: Error;
}

export function run(executable: string, args: readonly string[], opts: { cwd?: string; input?: string } = {}): Ran {
  const ran = spawnSync(executable, args, { cwd: opts.cwd, input: opts.input, encoding: 'utf8', maxBuffer: OUTPUT_LIMIT });
  return { status: ran.status, stdout: ran.stdout ?? '', stderr: ran.stderr ?? '', ...(ran.error ? { error: ran.error } : {}) };
}
