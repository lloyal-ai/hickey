/**
 * What the gate says, and what it exits with. The verdict is a comparison, printed as one; the exit code is the
 * commit's fate.
 */
import type { Verdict } from './verdict.js';

export const EXIT = {
  /** The whole with the change makes more sense than it does today. */
  getsIn: 0,
  /** It does not. */
  refused: 1,
  /** The gate could not reach a verdict; never a pass. */
  failed: 2,
} as const;

export function render(verdict: Verdict): string {
  const lines = [
    'The whole today',
    `  ${verdict.wholeToday}`,
    '',
    'The whole with this change',
    `  ${verdict.wholeWithChange}`,
    '',
  ];
  for (const answer of verdict.answers) {
    lines.push(`${answer.question}. ${answer.answer}`);
    for (const finding of answer.findings) {
      const where = finding.line === null ? finding.file : `${finding.file}:${finding.line}`;
      const existing = finding.existing === null ? '' : ` (existing: ${finding.existing})`;
      const places = finding.places === null ? '' : ` (places: ${finding.places})`;
      lines.push(`   ${where}${existing}${places}: ${finding.statement}`);
    }
  }
  lines.push('', verdict.getsIn ? `Gets in: ${verdict.reason}` : `Refused: ${verdict.reason}`);
  return lines.join('\n');
}

/** The verdict as a job's step summary. */
export function summary(verdict: Verdict): string {
  return `## Acceptance gate\n\n\`\`\`\n${render(verdict)}\n\`\`\`\n`;
}

export function exitCode(verdict: Verdict): number {
  return verdict.getsIn ? EXIT.getsIn : EXIT.refused;
}
