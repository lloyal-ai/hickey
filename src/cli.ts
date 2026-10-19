#!/usr/bin/env node
/**
 * `hickey staged` on every commit, `hickey uncommitted` while working, `hickey range <base>...<head>` to judge a
 * branch whole; `hickey trailer <message-file> [source]` from `prepare-commit-msg`, `hickey committed` from
 * `post-commit`; and `hickey carried <base>...<head>`, the check that every commit in a range carries the record,
 * for a pull request or a release, with no judge. `--full` prints the judge's answer to each question above its findings.
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { gate } from './index.js';
import { JudgeFailed } from './judge.js';
import { isScopeKind, readDelta, SCOPES, type Scope } from './delta.js';
import { GitFailed, repositoryRoot } from './git.js';
import { hooksWarning } from './hooks.js';
import { forgetRefusals } from './record.js';
import { EXIT, exitCode, render, spent, summary, type Rendering } from './report.js';
import { annotates, carried, trailersFor, writeTrailers } from './trailer.js';

function usage(): number {
  process.stderr.write(`${USAGE}\n`);
  return EXIT.failed;
}

/** Judge a scope, print the verdict and what it cost, and say the exit code. */
function judged(scope: Scope, rendering: Rendering): number {
  const outcome = gate(process.cwd(), scope);
  if (outcome.kind === 'skipped') {
    process.stdout.write(`hickey: ${outcome.reason}\n`);
    return EXIT.getsIn;
  }
  process.stdout.write(`${render(outcome.verdict, rendering)}\n${spent(outcome.spent)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(outcome.verdict));
  return exitCode(outcome.verdict);
}

function trailer(rest: readonly string[]): number {
  const [messageFile, source] = rest;
  if (!messageFile) return usage();
  if (!annotates(source)) return EXIT.getsIn;
  const root = repositoryRoot(process.cwd());
  writeTrailers(root, messageFile, trailersFor(root, readDelta(root, { kind: 'staged' })));
  return EXIT.getsIn;
}

function committed(): number {
  forgetRefusals(repositoryRoot(process.cwd()));
  return EXIT.getsIn;
}

/** Whether every commit in a range carries the gate's record, for a pull request or a release, with no judge. */
function carries(rest: readonly string[]): number {
  const [range] = rest;
  if (!range) return usage();
  const commits = carried(repositoryRoot(process.cwd()), range);
  for (const c of commits) process.stdout.write(`${c.commit} ${c.record ?? 'carries no record'}  ${c.subject}\n`);
  const missing = commits.filter((c) => c.record === null);
  if (missing.length > 0) process.stderr.write(`hickey: ${missing.length} of ${commits.length} commits carry no record; the gate did not see them\n`);
  return missing.length === 0 ? EXIT.getsIn : EXIT.refused;
}

/** The commands that are not a scope to judge, each with its usage line; a scope's comes from `SCOPES`. */
const COMMANDS: Record<string, { usage: string; run: (rest: readonly string[]) => number }> = {
  trailer: { usage: 'hickey trailer <message-file> [source]  from prepare-commit-msg: write the record into the message', run: trailer },
  committed: { usage: 'hickey committed                        from post-commit: the record has been carried', run: committed },
  carried: { usage: 'hickey carried <base>...<head>          every commit in a range carries the record: a pull request, a release', run: carries },
};

const USAGE = [
  'usage:',
  ...[...Object.values(SCOPES), ...Object.values(COMMANDS)].map((entry) => `  ${entry.usage}`),
  '',
  '  --full    print the judge\'s answer to each question above its findings',
].join('\n');

function main(argv: string[]): number {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: { full: { type: 'boolean', default: false } } });
  const [command = '', ...rest] = positionals;
  try {
    const warning = hooksWarning(repositoryRoot(process.cwd()));
    if (warning !== null) process.stderr.write(`hickey: ${warning}\n`);
    if (Object.hasOwn(COMMANDS, command)) return COMMANDS[command]!.run(rest);
    const scope = isScopeKind(command) ? SCOPES[command].parse(rest) : null;
    return scope === null ? usage() : judged(scope, { full: values.full });
  } catch (err) {
    if (err instanceof JudgeFailed || err instanceof GitFailed) {
      process.stderr.write(`hickey: ${err.message}\n`);
      return EXIT.failed;
    }
    throw err;
  }
}

process.exitCode = main(process.argv.slice(2));
