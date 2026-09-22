---
name: crew-setup
description: Fill in this project's crew config and project brief by reading the repository, rather than leaving CHANGE-ME placeholders. Use after `crew init`, or when the user says "set up crew here", "configure crew", "what should verify be", or `crew doctor` reports the config is unset.
---

# Setting up a project

`crew init` writes the files. This fills them in, and almost everything it
needs is already in the repository — you should be asking the user two or three
questions, not fifteen.

**One rule governs the whole skill: derive from evidence, never invent.** A
`verify` command that does not run is worse than `CHANGE-ME`, because
`crew doctor` goes quiet and the failure moves to the gate, three tasks later,
in someone else's worktree. If you cannot find something, leave the placeholder
and say which one you left.

## 1. Make sure the files exist

```sh
npx crew init
npx crew doctor
```

`doctor` lists every fault at once. That list is your worklist.

## 2. Read the project

Look before you ask. In rough order of what settles the most:

| Field | Where it comes from |
|---|---|
| `verify` | `package.json` scripts (`verify`, `test`, `check`), `justfile`, `Makefile`, `pyproject.toml`, `tox.ini`, `noxfile.py` — and the CI workflow, which is the definitive answer because it is what actually gates merges today |
| `quickVerify` | the same list, minus the slow parts — unit tests without e2e, lint without a build |
| `prepare` | anything CI runs *before* the tests: an install, a fixture, a seed, a build step |
| `baseBranch` | `git symbolic-ref refs/remotes/origin/HEAD`, not an assumption that it is `main` |
| `scopes.fromDir` | the source roots that actually exist. The template says `["src"]`; a Django project wants the app package, a monorepo wants each workspace |
| `commit.types` | `git log --format=%s -200` — if the project already uses a convention, match it. A hook that rejects the team's normal commits gets switched off in a week |
| `project` | the repository name, unless the user calls it something else |

**Run the `verify` command before you write it down.** Once. If it fails on a
clean checkout, that is not a config to save — it is either the wrong command
or a broken baseline, and both are worth knowing now rather than at the first
gate.

## 3. Ask only what the repository cannot tell you

**`environments` is the one that always needs a person.** Nothing in a
repository says which machine can prove what. Ask plainly:

> Can this laptop prove a change is done, or is there something only staging,
> real hardware or a person can settle?

If everything is provable locally, one `laptop` environment is the right
answer and you are finished. If not, the environment with
`reachableFromAgents: false` is the important one: it earns its own
`pending-<name>` status, and that status is the only thing stopping
code-complete work from calling itself done.

Also worth one question each, and only if the repository is ambiguous:
whether there is a deploy the orchestrator may run, and whether a
`decisionsFile` already exists to write prose decisions into.

## 4. Write the project brief

`.claude/crew/project.md` is where a project stops being generic, and it is
the half of this that a template cannot do for you. The worker and the
reviewer both include it.

**Write it from the repository, not from imagination.** Places to look for
things that are actually true:

- `git log --grep='revert\|hotfix\|regression' --oneline -50` — what has gone
  wrong here before, and in which files
- an existing `CONTRIBUTING.md`, `CLAUDE.md` or `docs/decisions.md`
- the files with the most churn that also have the least test coverage
- anything the CI workflow guards that the test suite does not

Keep it to **what makes a plausible-looking diff wrong here** — the section
headings in the template say it. A runtime ceiling, a protocol the server
rejects, a migration that must not be reordered, a file where an innocent edit
breaks something two services away.

**An empty section beats an invented one.** "Follow good practice" and "write
clean code" cost tokens in every downstream agent and change no behaviour. If
you genuinely cannot find a hard constraint in this repository, write `None
found yet — add one the first time a diff surprises you.` and move on. That
sentence is honest and it ages into something real.

## 5. Show it, then confirm

Show the user the config diff and the brief, in a few lines — not the whole
file. Name anything you left as `CHANGE-ME` and why.

Then:

```sh
npx crew doctor
```

It must come back clean, or the faults it still reports must be ones the user
has agreed to leave. Tell them `/crew:crew-spec` is next.

## What not to do

- **Do not invent a `verify`.** An unrunnable command that satisfies `doctor`
  is the one failure mode this skill exists to prevent.
- **Do not widen `scopes.fromDir` to the repository root.** Every directory
  under it becomes a valid commit scope, and the convention stops meaning
  anything.
- **Do not fill `environments` with a guess.** A wrong one either blocks tasks
  that were provable or, far worse, lets unprovable work be marked `done`.
- **Do not write a tour of the codebase into `project.md`.** The spec names
  the files. A worker that reads a codebase tour instead of writing code has
  cost you the thing crew exists to save.
