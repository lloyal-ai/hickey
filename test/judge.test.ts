import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { Delta } from '../src/delta.js';
import { CLAUDE_CODE_AT_LEAST, framing, judge, judgeArguments, judgeAvailability, JudgeFailed, STDIN_LIMIT } from '../src/judge.js';

const fakeClaude = join(fileURLToPath(new URL('.', import.meta.url)), 'fake-claude.mjs');

const delta: Delta = {
  scope: { kind: 'staged' },
  files: ['src/a.ts', 'src/b.ts'],
  diff: 'diff --git a/src/a.ts b/src/a.ts\n+export const a = 1;\n',
};
const principles = join(mkdtempSync(join(tmpdir(), 'gate-')), 'PRINCIPLES.md');
writeFileSync(principles, '# Principles\n');
const opts = { principlesPath: principles, claude: fakeClaude };

const withMode = <T>(mode: string, run: () => T): T => {
  const before = process.env.FAKE_CLAUDE_MODE;
  process.env.FAKE_CLAUDE_MODE = mode;
  try { return run(); } finally {
    if (before === undefined) delete process.env.FAKE_CLAUDE_MODE; else process.env.FAKE_CLAUDE_MODE = before;
  }
};

describe('the judge', () => {
  it('returns the structured verdict the judge answered with', () => {
    const verdict = withMode('verdict', () => judge('/tmp', delta, DEFAULT_CONFIG, opts));
    expect(verdict.getsIn).toBe(true);
    expect(verdict.answers[0]?.question).toBe(1);
  });

  it('returns a refusal with its findings intact', () => {
    const verdict = withMode('refused', () => judge('/tmp', delta, DEFAULT_CONFIG, opts));
    expect(verdict.getsIn).toBe(false);
    expect(verdict.answers[0]?.findings[0]).toMatchObject({ file: 'src/a.ts', line: 4, places: 2 });
  });

  it.each(['no-structured', 'error', 'malformed', 'exit'])('fails closed when the judge answers "%s"', (mode) => {
    expect(() => withMode(mode, () => judge('/tmp', delta, DEFAULT_CONFIG, opts))).toThrow(JudgeFailed);
  });

  it('fails closed when the executable does not exist', () => {
    expect(() => judge('/tmp', delta, DEFAULT_CONFIG, { ...opts, claude: '/nonexistent/claude' })).toThrow(JudgeFailed);
    expect(judgeAvailability('/nonexistent/claude')).toMatchObject({ kind: 'absent', reason: expect.stringContaining('not installed') });
    expect(judgeAvailability(fakeClaude)).toEqual({ kind: 'available' });
  });

  it('knows a Claude Code older than the one its flags are pinned against', () => {
    process.env.FAKE_CLAUDE_VERSION = '2.0.0';
    try { expect(judgeAvailability(fakeClaude)).toMatchObject({ kind: 'too-old', version: '2.0.0', reason: expect.stringContaining('older than') }); } finally { delete process.env.FAKE_CLAUDE_VERSION; }
    expect(judgeAvailability(fakeClaude)).toEqual({ kind: 'available' });
    expect(CLAUDE_CODE_AT_LEAST).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('refuses a change above the stdin limit instead of judging part of it', () => {
    const huge: Delta = { ...delta, diff: 'x'.repeat(STDIN_LIMIT + 1) };
    expect(() => judge('/tmp', huge, DEFAULT_CONFIG, opts)).toThrow(/above the judge/);
  });

  it('pins the flag set: principles as system prompt, read-only tools, no prompts, schema, model, turn cap', () => {
    const args = judgeArguments(DEFAULT_CONFIG, opts);
    expect(args).toEqual(expect.arrayContaining(['-p', '--append-system-prompt-file', principles, '--tools', 'Read,Grep,Glob', '--permission-mode', 'dontAsk', '--output-format', 'json', '--model', DEFAULT_CONFIG.model, '--max-turns', String(DEFAULT_CONFIG.maxTurns)]));
    expect(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2)).toEqual(['--setting-sources', '']);
    expect(args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']));
    expect(args).not.toContain('--bare');
    const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]!) as { required?: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(['wholeToday', 'wholeWithChange', 'answers', 'getsIn', 'reason']));
  });

  it('hands the judge the kind of repository, the files and the diff, and the real arguments', () => {
    const record = join(mkdtempSync(join(tmpdir(), 'gate-')), 'record.json');
    process.env.FAKE_CLAUDE_RECORD = record;
    try { withMode('verdict', () => judge('/tmp', delta, { ...DEFAULT_CONFIG, kind: 'framework' }, opts)); } finally { delete process.env.FAKE_CLAUDE_RECORD; }
    const seen = JSON.parse(readFileSync(record, 'utf8')) as { argv: string[]; input: string };
    expect(seen.input).toBe(framing(delta, { ...DEFAULT_CONFIG, kind: 'framework' }));
    expect(seen.input).toContain('framework repository');
    expect(seen.input).toContain('- src/b.ts');
    expect(seen.input).toContain('+export const a = 1;');
    expect(seen.argv).toEqual(judgeArguments({ ...DEFAULT_CONFIG, kind: 'framework' }, opts));
  });
});
