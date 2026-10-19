/**
 * What a repository tells the gate about itself: `hickey.config.json` at the repository root. Its numbers bound
 * the judge, never the change: nothing here is a threshold a delta could be shaped to pass.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const Config = z.object({
  /** What kind of repository the judge is told it is reading, in the one sentence that frames the change.
   *  The principles are the same for every kind. */
  kind: z.enum(['framework', 'tooling', 'harness']),
  /** `required`: no judge, no commit. `when-available`: a repository whose developers may not have the judge
   *  installed is not blocked for a tool they do not have; the gate says the change was not judged. */
  judging: z.enum(['required', 'when-available']),
  /** The model the judge runs on, by full id. */
  model: z.string(),
  /** How many turns the judge may take reading the repository before it must answer. */
  maxTurns: z.number().int().positive(),
  /** The repository's own principles document, as a path from the repository root. Absent, the judge reads
   *  the document this package ships. */
  principles: z.string().optional(),
});

export type Config = z.output<typeof Config>;

export const CONFIG_FILE = 'hickey.config.json';

/** A repository that says nothing is judged as a harness whose developers may lack the judge. */
export const DEFAULT_CONFIG: Config = {
  kind: 'harness',
  judging: 'when-available',
  model: 'claude-fable-5-1',
  maxTurns: 30,
};

/** The principles this package ships, read when a repository names none of its own. */
export const DEFAULT_PRINCIPLES_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'PRINCIPLES.md');

/** The principles the judge reads for this repository: its own document when the config names one, else the default. */
export const principlesPath = (root: string, config: Config): string =>
  config.principles === undefined ? DEFAULT_PRINCIPLES_PATH : join(root, config.principles);

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

/** The principles document the judge reads, as text: what a verdict was judged by. */
export const readPrinciples = (root: string, config: Config): string => readFileSync(principlesPath(root, config), 'utf8');
