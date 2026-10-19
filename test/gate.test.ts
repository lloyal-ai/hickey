import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE } from '../src/config.js';
import { gate } from '../src/index.js';
import { recall } from '../src/record.js';
import { repo, repoWithStagedChange } from './git.js';

const fakeClaude = join(fileURLToPath(new URL('.', import.meta.url)), 'fake-claude.mjs');

/** What the stand-in judge saw of `a.ts` and where it ran, for one gate call. */
function judgeSees(run: () => unknown): { cwd: string; read: string | null } {
  const record = join(mkdtempSync(join(tmpdir(), 'gate-')), 'record.json');
  process.env.FAKE_CLAUDE_RECORD = record;
  process.env.FAKE_CLAUDE_READ = 'a.ts';
  try { run(); } finally { delete process.env.FAKE_CLAUDE_RECORD; delete process.env.FAKE_CLAUDE_READ; }
  return JSON.parse(readFileSync(record, 'utf8')) as { cwd: string; read: string | null };
}

describe('the gate as one operation', () => {
  it('judges a staged change and remembers the verdict for the commit to carry', () => {
    const root = repoWithStagedChange();
    const outcome = gate(root, { kind: 'staged' }, fakeClaude);
    expect(outcome.kind).toBe('judged');
    if (outcome.kind !== 'judged') return;
    expect(outcome.verdict.getsIn).toBe(true);
    expect(outcome.delta.files).toEqual(['a.ts']);
    expect(recall(root).last?.verdict).toEqual(outcome.verdict);
  });

  it('judges the uncommitted changes without remembering them: that verdict is not the one a commit carries', () => {
    const root = repo();
    writeFileSync(join(root, 'a.ts'), 'export const a = 5;\n');
    const outcome = gate(root, { kind: 'uncommitted' }, fakeClaude);
    expect(outcome.kind).toBe('judged');
    expect(recall(root).last).toBeNull();
  });

  it('gives the judge the change as it would be committed, never the working tree beside it', () => {
    const root = repoWithStagedChange();
    writeFileSync(join(root, 'a.ts'), 'export const a = 3;\n');
    const seen = judgeSees(() => gate(root, { kind: 'staged' }, fakeClaude));
    expect(seen.read).toBe('export const a = 2;\n');
    expect(seen.cwd).not.toBe(realpathSync(root));
    expect(existsSync(seen.cwd)).toBe(false);
  });

  it('gives the judge the working tree itself for the uncommitted changes', () => {
    const root = repo();
    writeFileSync(join(root, 'a.ts'), 'export const a = 5;\n');
    const seen = judgeSees(() => gate(root, { kind: 'uncommitted' }, fakeClaude));
    expect(seen.read).toBe('export const a = 5;\n');
    expect(realpathSync(seen.cwd)).toBe(realpathSync(root));
  });

  it('judges nothing when there is no change', () => {
    expect(gate(repo(), { kind: 'staged' }, fakeClaude)).toEqual({ kind: 'skipped', reason: 'there is no change to judge' });
  });

  it('skips a missing judge only where the repository allows it, and refuses where it requires one', () => {
    const allowed = repoWithStagedChange();
    expect(gate(allowed, { kind: 'staged' }, '/nonexistent/claude')).toMatchObject({ kind: 'skipped' });
    const required = repoWithStagedChange();
    writeFileSync(join(required, CONFIG_FILE), JSON.stringify({ kind: 'framework', judging: 'required' }));
    expect(() => gate(required, { kind: 'staged' }, '/nonexistent/claude')).toThrow(/requires the judge/);
  });
});
