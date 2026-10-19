/**
 * The change under judgment, read whole from git: the diff and the files it touches. The ways to name a change
 * are one table, `SCOPES`: how the command line spells each, what the judge is told it is reading, whether its
 * verdict is the one a commit carries, and how it is read from git.
 */
import { beforeHead, git, indexTree, lines, treeOf } from './git.js';

export type Scope =
  | { kind: 'staged' }
  | { kind: 'uncommitted' }
  | { kind: 'range'; spec: string }
  /** The staged changes together with the commit they amend: what `git commit --amend` would make. */
  | { kind: 'amend' };

type Of<K extends Scope['kind']> = Extract<Scope, { kind: K }>;

export interface Delta {
  scope: Scope;
  /** The unified diff. */
  diff: string;
  /** The files the change touches, relative to the repository root. */
  files: string[];
  /** The tree the judge reads as the repository: the content as it would be committed, or null for the
   *  working tree on disk. The diff says what changes; the tree is what it changes in. */
  tree: string | null;
}

export const isEmpty = (delta: Delta): boolean => delta.files.length === 0;

/** `git diff --no-index` exits 1 when the two sides differ, which is the answer, not a failure. */
const DIFFERENCES_FOUND = 1;

/** One `git diff` and the files it names, in `tree`. */
function diffed(root: string, scope: Scope, args: readonly string[], tree: string | null): Delta {
  return { scope, diff: git(root, ['diff', ...args]), files: lines(git(root, ['diff', ...args, '--name-only'])), tree };
}

/** The head of a range spec, `base..head` or `base...head`, as git reads it: an empty head is HEAD. A bare
 *  revision is not a range; git diffs it against the working tree, so there is no head. */
const rangeHead = (spec: string): string | null => {
  const head = spec.split(/\.{2,3}/)[1];
  if (head === undefined) return null;
  return head === '' ? 'HEAD' : head;
};

/** An untracked file as the diff that adds it, read against nothing so the index stays as it is. */
function added(root: string, file: string): string {
  return git(root, ['diff', '--no-index', '--', '/dev/null', file], [0, DIFFERENCES_FOUND]);
}

interface ScopeEntry<K extends Scope['kind']> {
  /** The command line's word for it, as the usage shows. */
  usage: string;
  /** What the judge is told it is reading. */
  sentence: string;
  /** Whether this scope's verdict is the one a commit carries in its trailers. */
  remembered: boolean;
  /** The scope from the words after the command, or null when they do not make one. */
  parse(rest: readonly string[]): Of<K> | null;
  read(root: string, scope: Of<K>): Delta;
}

export const SCOPES: { [K in Scope['kind']]: ScopeEntry<K> } = {
  staged: {
    usage: 'hickey staged                judge what is staged, as it would be committed',
    sentence: 'the staged changes, as they would be committed',
    remembered: true,
    parse: () => ({ kind: 'staged' }),
    read: (root, scope) => diffed(root, scope, ['--cached'], indexTree(root)),
  },
  uncommitted: {
    usage: 'hickey uncommitted           judge every uncommitted change against the last commit',
    sentence: 'the uncommitted changes against the last commit',
    remembered: false,
    parse: () => ({ kind: 'uncommitted' }),
    read: (root, scope) => {
      const tracked = diffed(root, scope, ['HEAD'], null);
      const untracked = lines(git(root, ['ls-files', '--others', '--exclude-standard']));
      return {
        scope,
        diff: [tracked.diff, ...untracked.map((file) => added(root, file))].join(''),
        files: [...tracked.files, ...untracked],
        tree: null,
      };
    },
  },
  range: {
    usage: 'hickey range <base>...<head> judge the commits between two points, whole',
    sentence: 'the range between two commits',
    remembered: false,
    parse: (rest) => (rest[0] ? { kind: 'range', spec: rest[0] } : null),
    read: (root, scope) => {
      const head = rangeHead(scope.spec);
      return diffed(root, scope, [scope.spec], head === null ? null : treeOf(root, head));
    },
  },
  amend: {
    usage: 'hickey amend                 judge the staged changes together with the commit they amend',
    sentence: 'the staged changes together with the commit they amend, as the amended commit would be',
    remembered: true,
    parse: () => ({ kind: 'amend' }),
    read: (root, scope) => diffed(root, scope, ['--cached', beforeHead(root)], indexTree(root)),
  },
};

export const isScopeKind = (word: string): word is Scope['kind'] => Object.hasOwn(SCOPES, word);

export function readDelta<K extends Scope['kind']>(root: string, scope: Of<K>): Delta {
  const entry: ScopeEntry<K> = SCOPES[scope.kind];
  return entry.read(root, scope);
}
