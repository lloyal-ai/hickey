# @lloyal-labs/gate

The acceptance gate for a repository built with the Lloyal Harness Development Kit. A change is judged over its whole delta against the engineering principles in `PRINCIPLES.md`, and gets in only when the whole with it makes more sense than it does today.

The judge is a headless Claude Code session on your own login, with nothing of yours loaded into it (no settings from any source, no hooks, no MCP servers, no skills), three read-only tools over the repository, the principles as its system prompt and the change on its standard input. It answers with a comparison of the codebase as it is and as it would be, the answers to the principles' questions with evidence, and a verdict. Nothing is judged in part: a run error, a hit turn cap or a missing answer is a failure, never a pass.

## Install

```sh
npm install --save-dev @lloyal-labs/gate lefthook
```

`lefthook.yml` at the repository root:

```yaml
pre-commit:
  commands:
    gate:
      run: npx gate staged
prepare-commit-msg:
  commands:
    gate:
      run: npx gate trailer {1} {2}
post-commit:
  commands:
    gate:
      run: npx gate committed
```

`gate.config.json` at the repository root, all fields optional:

```json
{
  "kind": "harness",
  "eval": "when-available"
}
```

`kind` is `framework`, `tooling` or `harness` and tells the judge what it is reading. `eval` is `required` (no judge, no commit) or `when-available` (a developer without Claude Code is not blocked; the gate says the change was not judged). `model` and `maxTurns` pin the judge.

## Use

```sh
gate staged                      # what is staged, as it would be committed
gate uncommitted                 # the uncommitted changes against the last commit
gate range origin/main...HEAD    # a range, judged whole
gate carried origin/main...HEAD  # every commit carries the record: the pull-request check, no judge
```

Exit 0 when the change gets in, 1 when it is refused, 2 when no verdict could be reached. `git commit --no-verify` is the committer's explicit acceptance of a refusal; nothing else bypasses the gate.

## The record

The commit carries what the gate said, as git trailers written by `git interpret-trailers` from the `prepare-commit-msg` hook:

```
Gate: gets in. The whole has one reading of the record where it had one before.
Gate-Refused-Before: 2. A second reader of the record beside the first.
```

A commit made with `--no-verify` still runs that hook, so an accepted refusal reads `Gate: refused; accepted by the committer.` with the refusal's reason. The verdicts and refusals live under the repository's git directory, never in the tree, and the journal of refusals starts again once a commit exists, from the `post-commit` hook. A merge, a squash or an amended commit is left alone. The judge runs locally, before every commit. A pull request is checked in seconds with `gate carried`, which reads the `Gate` trailer of every commit in the range through git's own trailer parser and refuses when any commit carries none; a `--no-verify` commit carries its accepted refusal and is visible to the reviewer. `gate range` judges a range whole when someone wants the judge's reading of a branch; it writes the verdict to a job's step summary when run in CI.

## Principles

The judge reads the `PRINCIPLES.md` this package ships and nothing else; every repository is judged by the same document. It is written for a judge: the values with their reasons, the questions a reviewer asks in order, judgments to calibrate against, and what does not count as evidence.
