/**
 * The judge: one headless Claude Code session on the developer's own login, with nothing of the developer's
 * loaded into it, read-only over the repository, with the principles as its system prompt and the change on
 * stdin, answering in the verdict's schema. The flag set lives here because the defaults move, and the Claude
 * Code version it is pinned against is the package's own declaration. Any failure to produce a verdict is a
 * failure, never a pass.
 */
import { createRequire } from 'node:module';
import { coerce, gte } from 'semver';
import { z } from 'zod';
import { run } from './child.js';
import type { Config } from './config.js';
import { SCOPES, type Delta } from './delta.js';
import { Verdict, verdictJsonSchema } from './verdict.js';

/** The executable, as installed; a test hands in a stand-in. */
export const CLAUDE = 'claude';

/** The oldest Claude Code whose `-p` flags, JSON envelope and structured output match what this file assumes,
 *  declared once in the package's manifest so an installer can read the same number. */
export const CLAUDE_CODE_AT_LEAST: string = z.object({ claudeCode: z.string() }).parse(createRequire(import.meta.url)('../package.json')).claudeCode;

/** The CLI's piped-stdin limit; a change larger than this is refused rather than judged in part. */
export const STDIN_LIMIT = 10 * 1024 * 1024;

export class JudgeFailed extends Error {
  constructor(detail: string) {
    super(`the judge produced no verdict: ${detail}`);
    this.name = 'JudgeFailed';
  }
}

/** The envelope `claude -p --output-format json` prints; only the fields the gate reads. */
const Envelope = z.object({
  is_error: z.boolean().optional(),
  subtype: z.string().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  num_turns: z.number().int().optional(),
  usage: z.object({
    input_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
  }).optional(),
});

/** What a judgement took: the wall time the gate measured, and what the judge reported of its own run,
 *  the turns it spent reading and the tokens it read and wrote. Null where the judge reported nothing. */
export interface Spent {
  durationMs: number;
  turns: number | null;
  tokens: { read: number; written: number } | null;
}

/** The judge's usage as the gate reads it: everything the model read, from the prompt or the cache, and what it wrote. */
function tokensOf(usage: z.output<typeof Envelope>['usage']): Spent['tokens'] {
  if (usage === undefined) return null;
  const read = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  return { read, written: usage.output_tokens ?? 0 };
}

export interface Judged {
  verdict: Verdict;
  spent: Spent;
}

export interface JudgeOptions {
  /** The judge's document, as a path the CLI reads. */
  principlesPath: string;
  claude?: string;
}

export function framing(delta: Delta, config: Config): string {
  return [
    `You are judging ${SCOPES[delta.scope.kind].sentence} in a ${config.kind} repository.`,
    'Read any file in the repository you need; the diff below is the change, not the whole of what it touches.',
    '',
    'Files touched:',
    ...delta.files.map((file) => `- ${file}`),
    '',
    'The change:',
    '',
    delta.diff,
  ].join('\n');
}

/** The session is the judge's alone: no settings from any source, no hooks, no MCP servers, no skills, no
 *  session kept; three read-only tools; a turn cap; the model and the schema pinned. */
export function judgeArguments(config: Config, opts: JudgeOptions): string[] {
  return [
    '-p',
    '--setting-sources', '',
    '--settings', JSON.stringify({ disableAllHooks: true }),
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--append-system-prompt-file', opts.principlesPath,
    '--tools', 'Read,Grep,Glob',
    '--permission-mode', 'dontAsk',
    '--max-turns', String(config.maxTurns),
    '--model', config.model,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(verdictJsonSchema()),
  ];
}

export type Availability =
  | { kind: 'available' }
  | { kind: 'absent'; reason: string }
  | { kind: 'too-old'; version: string; reason: string };

/** Whether a judge this file can drive is installed; what `judging: when-available` asks before judging. */
export function judgeAvailability(claude = CLAUDE): Availability {
  const ran = run(claude, ['--version']);
  const version = ran.error || ran.status !== 0 ? undefined : coerce(ran.stdout)?.version;
  if (version === undefined) return { kind: 'absent', reason: 'Claude Code is not installed' };
  if (!gte(version, CLAUDE_CODE_AT_LEAST)) {
    return { kind: 'too-old', version, reason: `Claude Code ${version} is older than the ${CLAUDE_CODE_AT_LEAST} the judge needs` };
  }
  return { kind: 'available' };
}

export function judge(root: string, delta: Delta, config: Config, opts: JudgeOptions): Judged {
  const input = framing(delta, config);
  if (Buffer.byteLength(input, 'utf8') > STDIN_LIMIT) {
    throw new JudgeFailed(`the change is ${Buffer.byteLength(input, 'utf8')} bytes, above the judge's ${STDIN_LIMIT}-byte limit; judge it in parts`);
  }
  const started = performance.now();
  const ran = run(opts.claude ?? CLAUDE, judgeArguments(config, opts), { cwd: root, input });
  const durationMs = performance.now() - started;
  if (ran.error) throw new JudgeFailed(ran.error.message);
  if (ran.status !== 0) throw new JudgeFailed(`exit ${ran.status}: ${ran.stderr.trim() || ran.stdout.trim()}`);

  const envelope = Envelope.safeParse(parseJson(ran.stdout));
  if (!envelope.success) throw new JudgeFailed(`unreadable output: ${envelope.error.message}`);
  if (envelope.data.is_error) throw new JudgeFailed(`${envelope.data.subtype ?? 'error'}: ${envelope.data.result ?? ''}`);
  const verdict = Verdict.safeParse(envelope.data.structured_output);
  if (!verdict.success) throw new JudgeFailed(`no structured verdict (${envelope.data.subtype ?? 'unknown'}): ${verdict.error.message}`);
  return { verdict: verdict.data, spent: { durationMs, turns: envelope.data.num_turns ?? null, tokens: tokensOf(envelope.data.usage) } };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new JudgeFailed(`output is not JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}
