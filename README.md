<p align="center">
  <img src="assets/hickey.png" alt="hickey" width="160">
</p>

<h1 align="center">hickey</h1>

<p align="center"><strong>Make your coding agent write maintainable code.</strong></p>

<p align="center">
  <a href="#quick-start">Quick start</a> &nbsp;·&nbsp;
  <a href="#the-loop">How it works</a> &nbsp;·&nbsp;
  <a href="./PRINCIPLES.md">Principles</a> &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/@lloyal-labs/hickey">npm</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lloyal-labs/hickey"><img alt="npm" src="https://img.shields.io/npm/v/@lloyal-labs/hickey?label=npm&color=green"></a>
  <a href="./LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A524-green">
</p>

```sh
npm install --save-dev @lloyal-labs/hickey lefthook
npx lefthook install
```

> Simplicity is hard work. But, there's a huge payoff. The person who has a genuinely simpler system - a system made out of genuinely simple parts, is going to be able to affect the greatest change with the least work.
>
> He's going to kick your ass. He's gonna spend more time simplifying things up front and in the long haul he's gonna wipe the plate with you because he'll have that ability to change things when you're struggling to push elephants around.
>
> <p align="right">Rich Hickey, <em>Simplicity Matters</em></p>

hickey is a commit gate. Before a commit exists, a judge reads your whole repository and asks one question: **does the system make more sense with this change in it, or less?**

If less, the commit is refused with a precise instruction. Your agent revises and commits again. When it gets in, the commit carries the verdict and the number of rounds it took.

## Highlights

- **Judges the whole, not the diff.** The judge reads any file it needs. A change is compared as a system: the codebase as it is against the codebase with the change in it.
- **Refuses with an instruction.** Every finding names the file, the line, the existing thing it relates to, and how many places a rule now lives in.
- **Closes the loop around your agent.** A refusal exits non-zero, so the commit does not happen until a change passes. Refuse, revise, judge again, in.
- **Records everything in git.** The verdict and the refusal count are trailers on the commit, written by `git interpret-trailers`. A pull request is checked in seconds with no judge at all.
- **Your principles, or ours.** Ships with the simplicity principles of Rich Hickey's talks, written for a judge. Point it at your own document and it judges as your tech lead would.
- **Runs on your machine.** The judge is your own coding agent, isolated, read-only, with nothing of yours loaded. No service, no key in CI.

## Contents

1. [The loop](#the-loop)
2. [Example](#example)
3. [Why this exists](#why-this-exists)
4. [Quick start](#quick-start)
5. [Commands](#commands)
6. [What the judge asks](#what-the-judge-asks)
7. [Bring your own tech lead](#bring-your-own-tech-lead)
8. [Configuration](#configuration)
9. [Cost](#cost)
10. [FAQ](#faq)
11. [Roadmap](#roadmap)

## The loop

A commit gate is a loop, and the hook is what makes it one.

```mermaid
flowchart TD
    A[agent stages a change] --> B[git commit]
    B --> C["pre-commit: hickey staged<br/>the judge reads the principles, the diff,<br/>and any file in the repository it needs"]
    C --> D{verdict}
    D -- refused, exit 1 --> E["the shape: the one decision to make,<br/>then findings: file, line, the existing thing,<br/>how many places the rule now lives in"]
    E --> F[agent revises]
    F --> B
    D -- gets in, exit 0 --> G["prepare-commit-msg: hickey trailer<br/>Gate: gets in ...<br/>Gate-Refused-Before: N"]
    G --> H[the commit exists]
    H --> I["pull request or release:<br/>hickey carried base...head<br/>reads the trailers, seconds, no judge"]
```

- The agent's goal is a commit.
- A refusal exits non-zero. The commit does not happen. The goal stands unmet.
- hickey is the loop's condition, the agent is its body, and "gets in" is the exit.
- The only other exit is `git commit --no-verify`, recorded on the commit as the override it is.

Each round costs about a minute. Each round the verdict compares the whole system again, so the agent is not patching the last finding. It is converging on a shape the whole makes sense with.

The trailers are the record of the convergence. `Gate-Refused-Before: 3` means the shape took four rounds, and the last refusal's reason is right there for the reviewer.

## Example

The setup: a small app with one entity, `User`, read from a line of CSV by hand in `src/users.ts`. You ask your agent to add `Order`. It writes `src/orders.ts` the same way: split the line, pick the fields. Clean code, good names, a reviewer would approve it. The agent commits.

```
$ git commit -m "add an order reader"

The whole today
  The source tree holds one module, src/users.ts, with a User type and a
  hand-written reader that splits a comma-delimited line and destructures it
  positionally.

The whole with this change
  Two modules that each split a comma-delimited line and destructure it
  positionally, differing only in column names and one Number coercion. The
  splitting rule lives in two places with no owner, and the two files together
  teach that a new entity is added by copying the previous reader.

The shape
  The change lacks a decision about who owns reading a record from a delimited
  line. That ownership belongs to one reader, driven by a column list with
  per-column coercion, which the users module and the orders module both
  compose. Once that reader exists, adding Order is a type and a column list,
  the split rule moves in one place, and the next entity is cheaper to add
  than this one was.

Findings
   src/orders.ts:2 (existing: readUser in src/users.ts:2): readOrder is a copy
   of readUser with renamed columns and one coercion; it should be a
   composition of a single delimited-record reader.
   src/orders.ts:3 (existing: src/users.ts:3) (places: 2): line.split(',')
   appears in both readers; the splitting rule moves in two places where it
   previously moved in one.

Refused: The whole makes less sense with this change because the rule for
reading a delimited line now lives in two hand-written readers with no owner;
add the Order entity as a composition of one shared record reader that owns
the split and per-column coercion.
Judged in 39 s: 7 turns, 42k tokens read, 3k written.
```

Your agent reads the shape, not the findings one by one. It writes the one reader, commits again.

```
The shape
  The change rests on the decision that an entity is its columns and that
  reading a delimited line is one operation owned by record.ts. Once made,
  each entity module shrinks to an interface plus a column table, the split
  and coercions have a single owner, and the next entity or the next change
  to the format each touch one file.

Gets in: The whole makes more sense with this change: the rule for reading a
line moves from a function that would have been copied per entity to one
reader in record.ts that both entities compose, so the next entity and the
next format change are each one-file work.
Judged in 50 s: 7 turns, 44k tokens read, 3k written.
```

The commit carries both verdicts.

```
$ git log -1 --format=%B
add an order reader

Gate: gets in. The whole makes more sense with this change: the rule for reading a line moves ...
Gate-Refused-Before: 1 refusal on the way to this shape. Last: The whole makes less sense with this change because the rule for reading a delimited line now lives in two hand-written readers with no owner; ...
```

That transcript is real, trimmed for length. Two rounds: 39 seconds to the refusal, 50 to the commit that got in. Harder changes take more rounds, and the count rides on the commit.

Duplication is the easiest of the judge's eight questions to show. Most refusals are about where a concern lives, not copies.

## Why this exists

**Simple is not easy.** In Rich Hickey's distinction, simple means un-braided: one concern, one role, one lifetime per construct. Easy means near at hand. A change can be easy and make the system more complex. With coding agents, it usually does.

**Agent-written code is locally consistent.** Clean in its file. Well named. Tests green. Reviewer happy. And locally consistent is exactly how complexity hides, because the agent reasoned from the task in front of it and landed an aspect wherever it happened to be working:

- a handler bundle in a module that does eight other things
- a conditional chain where a table belongs
- a parser moved into the protocol file because both sides already imported it
- a helper that hides a braid instead of naming a responsibility
- the thirty-sixth slightly different implementation of a thing that exists

**Every check you have passes it.**

| check | what it sees | what it misses |
|---|---|---|
| diff review | the change | the system it lands in |
| type checker, linter | a rule against a line | where a concern belongs |
| clone detector | copies | a function rewritten with a new name, and everything else on this list |
| tests | the task | whether the next change is cheaper |

**The braid grows faster than anyone can read it.** Six months later a one-line change touches a hundred places and you are pushing elephants around. An application that works but whose code is braided is not a lesser success. It is damage, and the cost lands on whoever has to change it next.

**hickey asks what a tech lead who holds the whole system in their head would ask**, over the whole change, by reading the repository. Then it gives one verdict as a comparison, not a count of findings. A correct capability that leaves the whole no more sensible does not get in. A change that makes the whole make more sense gets in, even when it is longer, because the next change will be cheaper.

## Quick start

```sh
npm install --save-dev @lloyal-labs/hickey lefthook
npx lefthook install
```

The package is scoped; the binary it installs is `hickey`, which is what the hooks and every command below run.

The second command matters. npm no longer runs a dependency's install scripts, so lefthook does not install its hooks on its own. hickey warns you if it sees a `lefthook.yml` naming it with no hook installed.

`lefthook.yml` at the repository root:

```yaml
output: [execution_out]
pre-commit:
  commands:
    hickey:
      run: npx hickey staged
prepare-commit-msg:
  commands:
    hickey:
      run: npx hickey trailer {1} {2}
post-commit:
  commands:
    hickey:
      run: npx hickey committed
```

That is the whole setup. No config file is required.

The judge needs [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in. The minimum version is declared in the package manifest and checked before judging.

## Commands

```sh
hickey staged                      # what is staged, as it would be committed
hickey uncommitted                 # everything uncommitted, against the last commit
hickey range origin/main...HEAD    # a branch, judged whole
hickey carried origin/main...HEAD  # every commit carries a verdict: for a pull request or a release
hickey staged --full               # the judge's full answer to each question
```

| exit | meaning |
|---|---|
| `0` | gets in |
| `1` | refused |
| `2` | no verdict could be reached, or usage |

`git commit --no-verify` is the committer's explicit acceptance of a refusal, and the commit says so. Nothing else bypasses the gate.

## What the judge asks

Eight questions, in order, over the whole change.

1. **What does it do?** In one sentence. If one sentence cannot hold it, that is the first finding.
2. **What aspect does it address, and who else touches that aspect?** Is the change placed where those components meet, or where this task happened to be working?
3. **Does something like this already exist?** A composition of it, an extension at its owning boundary, or a variation beside it? Only the first two are acceptable.
4. **How many places does one rule now live in?** One is an abstraction. Several is the braid beginning.
5. **Does the file still read as its name?**
6. **Would a developer reading this as the reference respect it?**
7. **Is the structure declarative?** Data and tables, or control flow a reader must execute in their head?
8. **Did it meet the letter of a principle while defeating its intent?** A copy parameterised instead of composed. A rename in place of a redesign. A helper that hides a braid.

Then the shape. The judge reads its findings together and asks whether they are separate issues or symptoms of one missing abstraction. When they are one, it names the decision: what it is, which component owns it, and what falls out of it. As often composing what exists as adding. A refusal names the decision to make, not the places to patch.

Then the verdict, as a comparison of the codebase with and without the change.

The full document is [`PRINCIPLES.md`](./PRINCIPLES.md): the values with their reasons, the questions, judgments to calibrate against, and what does not count as evidence.

## Bring your own tech lead

The shipped principles are a starting point. The document that judges best is yours: your tech lead's rulings, in the form `PRINCIPLES.md` shows.

```json
{
  "principles": "docs/PRINCIPLES.md"
}
```

Put that in `hickey.config.json` and every commit is judged against your document.

## Configuration

`hickey.config.json` at the repository root. Every field is optional.

| field | values | default | what it does |
|---|---|---|---|
| `principles` | path from the repository root | the shipped `PRINCIPLES.md` | the document the judge reads |
| `judging` | `required`, `when-available` | `when-available` | `required`: no judge, no commit. `when-available`: a developer without the judge is not blocked, and hickey says the change was not judged |
| `kind` | `framework`, `tooling`, `harness` | `harness` | the one word the judge is told about what it is reading |
| `model` | a model id | the current Claude | the judge's model |
| `maxTurns` | integer | `30` | how many turns the judge may spend reading before it must answer |

## Cost

- A judgement is about a minute and reads your repository. It runs on your coding agent's own account, so it costs what a minute of your agent costs, out of the same plan.
- Every verdict ends with what it took: the time, and the turns the judge spent reading and the tokens it read and wrote, as the judge reports them. No dollar figure: the judge runs on your account, and tokens are what your plan meters.
- Committing often? Run `hickey uncommitted` while you work and let the commit's run be the confirmation.
- Verdicts and the refusal journal live under your repository's git directory, never in the tree. Nothing is sent anywhere except to the agent you already use.

## FAQ

#### Is this a linter?

No. A linter checks a rule against a line. hickey compares two systems, the codebase with and without the change, and reads whatever files it needs to decide.

#### Is this a duplicate-code detector?

No. Duplication is one of eight questions, and the easiest to show in a README. Most refusals in practice are about placement, not copies.

#### Does it replace code review?

It replaces the part AI code review cannot do from where it stands.

A reviewer that sees only the diff is a hill-climber on a landscape it cannot see. It makes the change better by every measure available inside the change, then stops on top of a small hill: the local optimum, with no way of knowing a taller one exists elsewhere in the repository. Every suggestion is correct, and every one is about the diff.

That is the perfect blind spot for a coding agent. An agent optimises for a signal, the tests and the review. When the signal is diff-local, the cheapest way to satisfy it is a change that looks right on its own: a parameterised copy, a handler bundle where the task was working, a helper that hides the braid. That is reward hacking, and a diff-local review does not catch it. It rewards it.

Each diff makes sense alone. Over a few hundred of them the repository becomes a rich tapestry that no one fully understands, including the agents that wove it.

hickey moves the judgement to the whole: not the best version of this diff, but whether the system is simpler with it in. A tech lead who holds the codebase in their head does that by instinct. The judge does it by reading the codebase, every time.

#### What if I disagree with a refusal?

`git commit --no-verify`. The commit records that you overrode a refusal and why the judge refused, so the disagreement is on the record for the reviewer.

#### Can my agent read the verdict?

That is the point. The verdict is structured: the shape names the one decision to make, and the findings under it name the file, the line, the existing thing and the count. Let the agent run `git commit` and read the refusal itself. An agent that acts on the shape makes one decision; an agent that acts on the findings patches each place.

#### Does it need Claude Code?

Today, yes. A `command` judge that hands the principles and the change to any agent CLI and reads the verdict back is next.

#### Will it slow me down?

A minute per commit, and a minute less per review. The time, turns and tokens are printed on every verdict, so measure it on your repository.

#### Is this affiliated with Rich Hickey?

No. The shipped principles are the ideas of his talks Simple Made Easy and Simplicity Matters, in our words, as we apply them to reviewing a change. The project is not affiliated with or endorsed by him.

## Roadmap

- **Any agent as the judge.** A configured command hickey runs with the principles and the change, reading the verdict from its output. Codex, Gemini, whatever is on your machine.
- **A principles scaffold.** A starting document for a team to write their own tech lead's rulings into.
- **Generated files out of the delta.** Lockfiles cost the judge thousands of tokens and tell it nothing.

## Developing

```sh
git clone https://github.com/lloyal-ai/hickey && cd hickey
npm install          # also installs the hooks: hickey gates its own commits
npm run build
npm test             # runs against a stand-in judge; Claude Code is never run by the tests
```

Every commit to this repository goes through hickey. Read the trailers in `git log` to see what the judge said about each one.

A release is a pushed tag `vX.Y.Z` that matches the version in `package.json`. The workflow checks the match, checks that every commit since the previous release carries the gate's record, publishes to npm with provenance, and opens the GitHub release.

## License

[MIT](./LICENSE)
