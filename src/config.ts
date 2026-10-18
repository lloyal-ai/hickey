/**
 * What a repository tells the gate about itself: `gate.config.json` at the repository root. Its numbers bound
 * the judge, never the change: nothing here is a threshold a delta could be shaped to pass.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const Config = z.object({
  /** What kind of repository the judge is told it is reading. The document is the same for every kind. */
  kind: z.enum(['framework', 'tooling', 'harness']),
  /** `required`: no judge, no commit. `when-available`: a repository whose developers may not have Claude Code
   *  is not blocked for a tool they do not have; the gate says the judge was skipped. */
  eval: z.enum(['required', 'when-available']),
  /** The model the judge runs on, by full id. */
  model: z.string(),
  /** How many turns the judge may take reading the repository before it must answer. */
  maxTurns: z.number().int().positive(),
});

export type Config = z.output<typeof Config>;

export const CONFIG_FILE = 'gate.config.json';

/** A repository that says nothing is judged as a harness whose developers may lack the judge. */
export const DEFAULT_CONFIG: Config = {
  kind: 'harness',
  eval: 'when-available',
  model: 'claude-fable-5-1',
  maxTurns: 30,
};

/** The repository's configuration, with the defaults filled in for what it does not say. */
export function readConfig(root: string): Config {
  let text: string;
  try {
    text = readFileSync(join(root, CONFIG_FILE), 'utf8');
  } catch {
    return DEFAULT_CONFIG;
  }
  return Config.parse({ ...DEFAULT_CONFIG, ...Config.partial().parse(JSON.parse(text)) });
}
