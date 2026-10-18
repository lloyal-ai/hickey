import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_FILE, DEFAULT_CONFIG, readConfig } from '../src/config.js';
import { EXIT, exitCode, render, summary } from '../src/report.js';
import type { Verdict } from '../src/verdict.js';

describe('the configuration', () => {
  it('is the defaults when the repository says nothing', () => {
    expect(readConfig(mkdtempSync(join(tmpdir(), 'gate-cfg-')))).toEqual(DEFAULT_CONFIG);
  });

  it('fills in what the repository leaves out', () => {
    const root = mkdtempSync(join(tmpdir(), 'gate-cfg-'));
    writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ kind: 'framework', eval: 'required' }));
    expect(readConfig(root)).toEqual({ ...DEFAULT_CONFIG, kind: 'framework', eval: 'required' });
  });

  it('refuses a configuration it cannot read rather than guessing', () => {
    const root = mkdtempSync(join(tmpdir(), 'gate-cfg-'));
    writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ kind: 'spaceship' }));
    expect(() => readConfig(root)).toThrow();
  });
});

const refused: Verdict = {
  wholeToday: 'One reading.',
  wholeWithChange: 'Two readings.',
  answers: [{ question: 3, answer: 'A sibling exists.', findings: [{ file: 'src/a.ts', line: 4, existing: 'src/b.ts', places: 2, statement: 'A second reader beside the first.' }] }],
  getsIn: false,
  reason: 'The whole has two readings where it had one.',
};

describe('the report', () => {
  it('prints the comparison, the answers with their evidence, and the verdict', () => {
    const text = render(refused);
    expect(text).toContain('The whole today\n  One reading.');
    expect(text).toContain('The whole with this change\n  Two readings.');
    expect(text).toContain('src/a.ts:4 (existing: src/b.ts) (places: 2): A second reader beside the first.');
    expect(text).toContain('Refused: The whole has two readings where it had one.');
  });

  it('maps the verdict to the exit code: in, refused', () => {
    expect(exitCode(refused)).toBe(EXIT.refused);
    expect(exitCode({ ...refused, getsIn: true })).toBe(EXIT.getsIn);
    expect(render({ ...refused, getsIn: true })).toContain('Gets in:');
    expect(summary(refused)).toBe(`## Acceptance gate\n\n\`\`\`\n${render(refused)}\n\`\`\`\n`);
  });
});
