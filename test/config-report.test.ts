import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_FILE, DEFAULT_CONFIG, DEFAULT_PRINCIPLES_PATH, principlesPath, readConfig } from '../src/config.js';
import { EXIT, exitCode, render, spent, summary } from '../src/report.js';
import type { Verdict } from '../src/verdict.js';

describe('the configuration', () => {
  it('is the defaults when the repository says nothing', () => {
    expect(readConfig(mkdtempSync(join(tmpdir(), 'gate-cfg-')))).toEqual(DEFAULT_CONFIG);
  });

  it('fills in what the repository leaves out', () => {
    const root = mkdtempSync(join(tmpdir(), 'gate-cfg-'));
    writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ kind: 'framework', judging: 'required' }));
    expect(readConfig(root)).toEqual({ ...DEFAULT_CONFIG, kind: 'framework', judging: 'required' });
  });

  it('names the principles the judge reads: the shipped document unless the repository has its own', () => {
    expect(principlesPath('/repo', DEFAULT_CONFIG)).toBe(DEFAULT_PRINCIPLES_PATH);
    expect(principlesPath('/repo', { ...DEFAULT_CONFIG, principles: 'docs/PRINCIPLES.md' })).toBe('/repo/docs/PRINCIPLES.md');
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
  it('prints the comparison, the findings, and the verdict; the answers with their evidence on request', () => {
    const text = render(refused);
    expect(text).toContain('The whole today\n  One reading.');
    expect(text).toContain('The whole with this change\n  Two readings.');
    expect(text).toContain('src/a.ts:4 (existing: src/b.ts) (places: 2): A second reader beside the first.');
    expect(text).toContain('Findings\n   src/a.ts:4');
    expect(text).not.toContain('3. A sibling exists.');
    expect(render(refused, { full: true })).toContain('3. A sibling exists.\n   src/a.ts:4');
    expect(text).toContain('Refused: The whole has two readings where it had one.');
  });

  it('maps the verdict to the exit code: in, refused', () => {
    expect(exitCode(refused)).toBe(EXIT.refused);
    expect(exitCode({ ...refused, getsIn: true })).toBe(EXIT.getsIn);
    expect(render({ ...refused, getsIn: true })).toContain('Gets in:');
    expect(summary(refused)).toBe(`## Acceptance gate\n\n\`\`\`\n${render(refused, { full: true })}\n\`\`\`\n`);
  });

  it("says what a judgement cost, with the dollars when the judge reported them", () => {
    expect(spent({ durationMs: 47_300, usd: null })).toBe("Judged in 47 s.");
    expect(spent({ durationMs: 58_600, usd: 0.3149 })).toBe("Judged in 59 s for $0.31.");
  });
});
