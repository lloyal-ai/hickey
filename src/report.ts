/**
 * What the gate says, and what it exits with. The verdict is a comparison, printed as one; the exit code is the
 * commit's fate. The short form is what a person at a prompt reads: the two wholes, every finding, the verdict.
 * The full form adds the judge's answer to each question, for the reader who wants the evidence.
 */
import type { Spent } from './judge.js';
import type { Finding, Verdict } from './verdict.js';

export const EXIT = {
  /** The whole with the change makes more sense than it does today. */
  getsIn: 0,
  /** It does not. */
  refused: 1,
  /** The gate could not reach a verdict, or was not asked one it understands; never a pass. */
  failed: 2,
} as const;

export interface Rendering {
  /** The judge's answer to each numbered question above its findings. Off, the findings alone. */
  full: boolean;
}

const finding = (f: Finding): string => {
  const where = f.line === null ? f.file : `${f.file}:${f.line}`;
  const existing = f.existing === null ? '' : ` (existing: ${f.existing})`;
  const places = f.places === null ? '' : ` (places: ${f.places})`;
  return `   ${where}${existing}${places}: ${f.statement}`;
};

/** The middle of the report: the answers with their findings, or the findings alone. Empty when there is neither. */
function body(verdict: Verdict, rendering: Rendering): string[] {
  if (rendering.full) return verdict.answers.flatMap((a) => [`${a.question}. ${a.answer}`, ...a.findings.map(finding)]);
  const findings = verdict.answers.flatMap((a) => a.findings.map(finding));
  return findings.length === 0 ? [] : ['Findings', ...findings];
}

export function render(verdict: Verdict, rendering: Rendering = { full: false }): string {
  const middle = body(verdict, rendering);
  return [
    'The whole today',
    `  ${verdict.wholeToday}`,
    '',
    'The whole with this change',
    `  ${verdict.wholeWithChange}`,
    '',
    ...middle,
    ...(middle.length === 0 ? [] : ['']),
    verdict.getsIn ? `Gets in: ${verdict.reason}` : `Refused: ${verdict.reason}`,
  ].join('\n');
}

/** What the judgement cost, in one line. */
export function spent(cost: Spent): string {
  const seconds = Math.round(cost.durationMs / 1000);
  return cost.usd === null ? `Judged in ${seconds} s.` : `Judged in ${seconds} s for $${cost.usd.toFixed(2)}.`;
}

/** The verdict as a job's step summary, with the evidence. */
export function summary(verdict: Verdict): string {
  return `## Acceptance gate\n\n\`\`\`\n${render(verdict, { full: true })}\n\`\`\`\n`;
}

export function exitCode(verdict: Verdict): number {
  return verdict.getsIn ? EXIT.getsIn : EXIT.refused;
}
