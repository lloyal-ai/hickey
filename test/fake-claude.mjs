#!/usr/bin/env node
// A stand-in for `claude -p` under test: reads the prompt from stdin, records the arguments it was given, and
// answers as FAKE_CLAUDE_MODE says. The real judge is never run by the unit tests.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

if (process.argv.includes('--version')) {
  // The version the real judge is pinned against, from the one place it is declared.
  const { claudeCode } = createRequire(import.meta.url)('../package.json');
  process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION ?? claudeCode} (fake)\n`);
  process.exit(0);
}

const input = readFileSync(0, 'utf8');
if (process.env.FAKE_CLAUDE_RECORD) {
  writeFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ argv: process.argv.slice(2), input }));
}

const verdict = {
  wholeToday: 'One reading of the record.',
  wholeWithChange: 'Still one reading of the record, now shared.',
  answers: [{ question: 1, answer: 'It shares the record reading.', findings: [] }],
  getsIn: true,
  reason: 'The whole has one reading where it had one before.',
};

const answers = {
  verdict: () => ({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(verdict), structured_output: verdict }),
  refused: () => ({ type: 'result', subtype: 'success', is_error: false, structured_output: { ...verdict, getsIn: false, reason: 'A second reading of the record.',
    answers: [{ question: 3, answer: 'A sibling exists.', findings: [{ file: 'src/a.ts', line: 4, existing: 'src/b.ts readRecord', places: 2, statement: 'A second reader of the record beside the first.' }] }] } }),
  'no-structured': () => ({ type: 'result', subtype: 'success', is_error: false, result: 'I could not decide.' }),
  error: () => ({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Reached max turns' }),
};

const mode = process.env.FAKE_CLAUDE_MODE ?? 'verdict';
if (mode === 'malformed') { process.stdout.write('not json'); process.exit(0); }
if (mode === 'exit') { process.stderr.write('boom\n'); process.exit(3); }
process.stdout.write(JSON.stringify(answers[mode]()));
