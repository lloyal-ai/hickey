/**
 * The judge's answer, defined once. The JSON schema the headless judge is constrained to is derived from
 * this definition, and the judge's output is parsed by it, so the two cannot drift.
 */
import { z } from 'zod';

export const Finding = z.object({
  file: z.string().describe('The file the finding is about, relative to the repository root.'),
  line: z.number().int().nullable().describe('The line, when the finding has one.'),
  existing: z.string().nullable().describe('The existing thing the finding relates to: a definition, a file, a rule.'),
  places: z.number().int().nullable().describe('The count, where the question asked for one.'),
  statement: z.string().describe('The finding in one sentence a reader could act on.'),
});

export const Answer = z.object({
  question: z.number().int().min(1).describe('Which of the numbered questions this answers.'),
  answer: z.string().describe('The answer, with its evidence.'),
  findings: z.array(Finding),
});

export const Verdict = z.object({
  wholeToday: z.string().describe('What the whole looks like as it is, in a few sentences.'),
  wholeWithChange: z.string().describe('What the whole looks like with this change in it, in a few sentences.'),
  answers: z.array(Answer),
  getsIn: z.boolean().describe('True only when the whole with the change makes more sense than it does today.'),
  reason: z.string().describe('The verdict as the comparison, in one sentence a reader could act on.'),
});

export type Finding = z.output<typeof Finding>;
export type Answer = z.output<typeof Answer>;
export type Verdict = z.output<typeof Verdict>;

/** The schema as the judge receives it. */
export const verdictJsonSchema = (): Record<string, unknown> => {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(Verdict) as Record<string, unknown> & { $schema?: string };
  return schema;
};
