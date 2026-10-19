/**
 * Whether the repository's hooks will run hickey. A `lefthook.yml` that names hickey is the intent; the installed
 * `pre-commit` hook is the fact. When the first exists without the second, every commit goes through unjudged and
 * nothing says so, which is the one way a new repository fails silently.
 *
 * Both files are tested for a substring, not parsed: the question is presence (is hickey named, did lefthook write
 * the hook), and lefthook owns both formats. Reading them in full would be a second owner of each.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hooksDir } from './git.js';

const LEFTHOOK_FILE = 'lefthook.yml';

const mentions = (file: string, word: string): boolean => existsSync(file) && readFileSync(file, 'utf8').includes(word);

/** The one-line warning when the hooks are configured for hickey but not installed; null when there is nothing to say. */
export function hooksWarning(root: string): string | null {
  if (!mentions(join(root, LEFTHOOK_FILE), 'hickey')) return null;
  if (mentions(join(hooksDir(root), 'pre-commit'), 'lefthook')) return null;
  return `${LEFTHOOK_FILE} names hickey but no hook is installed, so commits are not judged; run: npx lefthook install`;
}
