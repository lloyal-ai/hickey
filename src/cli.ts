#!/usr/bin/env node
/**
 * `hickey staged` while working, `hickey uncommitted` for everything since the last commit, `hickey range
 * <base>...<head>` to judge a branch whole, `hickey amend` for what `git commit --amend` would make; `hickey
 * committing` from `pre-commit`, `hickey trailer <message-file> [source]` from `prepare-commit-msg`, `hickey
 * committed` from `post-commit`; and `hickey carried <base>...<head>`, the check that every commit in a range carries the record,
 * for a pull request or a release, with no judge. `--full` prints the judge's answer to each question above its findings.
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { committing, gate, recordCarried, recordForMessage, type Outcome } from './index.js';
import { JudgeFailed } from './judge.js';
import { isScopeKind, SCOPES, type Scope } from './delta.js';
import { GitFailed, repositoryRoot } from './git.js';
import { hooksWarning } from './hooks.js';
import { EXIT, exitCode, recorded, render, spent, summary, type Rendering } from './report.js';
import { carried, writeTrailers } from './trailer.js';

function usage(): number {
  process.stderr.write(`${USAGE}\n`);
  return EXIT.failed;
}

/** Print an outcome and say its exit code. */
function reported(outcome: Outcome, rendering: Rendering): number {
  if (outcome.kind === 'skipped') {
    process.stdout.write(`hickey: ${outcome.reason}\n`);
    return EXIT.getsIn;
  }
  const took = outcome.kind === 'judged' ? spent(outcome.spent) : recorded();
  process.stdout.write(`${render(outcome.verdict, rendering)}\n${took}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(outcome.verdict));
  return exitCode(outcome.verdict);
}

/** Judge a scope, print the verdict and what it cost, and say the exit code. */
const judged = (scope: Scope, rendering: Rendering): number => reported(gate(process.cwd(), scope), rendering);

/** From `pre-commit`: the commit's question. */
const precommit = (): number => reported(committing(process.cwd()), { full: false });

/** From `prepare-commit-msg` with git's own arguments, the message file and its source: the record, transcribed
 *  into the message for the commit it describes. */
function trailer(rest: readonly string[]): number {
  const [messageFile, source] = rest;
  if (!messageFile) return usage();
  const root = repositoryRoot(process.cwd());
  const record = recordForMessage(root, source);
  if (record.kind === 'written') writeTrailers(root, messageFile, record.record);
  return EXIT.getsIn;
}

function committed(): number {
  recordCarried(process.cwd());
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
  committing: { usage: 'hickey committing                       from pre-commit: what is being committed, judged or taken from the record', run: precommit },
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
