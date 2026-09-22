# crew

A task loop for coding agents. An approved spec, a worker in its own worktree,
a deterministic gate, and an independent review that cannot edit.

Project-agnostic: everything specific to a repository lives in two files it
owns — `.claude/crew.config.json` for the mechanics and
`.claude/crew/project.md` for the rules a wrong diff can satisfy.

## The shape

```
                    PLANNING (optional, its own plugin)
                      maps of the work, traced to evidence and to real symbols
                      agent-tasks → draft specs, refusing anything unresolved
                         │
YOU + ORCHESTRATOR (the main session — not an agent)
  /crew:crew-spec    read the plan → query the graph once → write the spec → YOU APPROVE
  /crew:crew-run     hand the task to its own session in its own worktree
                         │
                         ├─ TASK SESSION (the crew-worker skill)
                         │    implements, and cannot write outside files:
                         │    crew gate    → prepare + scope + verify, then stamp   [no model]
                         │    crew review  → opens a round, refuses one past the limit
                         │    spawns crew-reviewer (read-only)
                         │    writes its own status back to the task file
                         │
  /crew:crew-close   crew gate --check → YOU APPROVE → merge → graph → deploy
  /crew:crew-status  the board, rendered from the task files
```

**Two human gates: the spec, and the merge.** Everything between them runs
unattended, which is only safe because those two hold.

One session per task, one worktree per session. The orchestrator hands over and
reads the board; it does not watch, poll, or narrate.

## Install

Two scopes. **Once on this machine**, then **one command per project** — and
that per-project command writes only the two files that are genuinely about
that project.

### Once, on this machine

```bash
npm install --global pit-crew
```

The package is `pit-crew`; the command it installs is `crew`. To put it in one
project rather than on the machine, `npm install --save-dev pit-crew` — the
git hooks and CI both prefer a local copy when there is one.

```bash
crew init --global
```

That writes the git hooks to `$XDG_CONFIG_HOME/crew/githooks` and points
`git config --global core.hooksPath` at them, so no repository needs its own
copy. Two things make a machine-wide hooks path safe to accept:

- **Silent where crew is not used.** No `.claude/crew.config.json` in the repo
  and both hooks exit 0 without a word. A hook that fails in unrelated
  repositories is a hook you switch off within the week.
- **It chains to `.git/hooks`.** Setting `core.hooksPath` otherwise disables a
  repository's own hooks outright, so husky and friends would vanish the
  moment you went global. Crew's hooks run yours first and honour your
  verdict — crew is the addition, not the replacement.

A repository that sets its own `core.hooksPath` still wins, because git
prefers local config. Nothing already installed changes.

Then the plugins, for the skills:

```
/plugin marketplace add StuCM/claude-crew
```

```
/plugin install crew@claude-crew
```

```
/plugin install claude-crew-planning@claude-crew
```

The second installs on its own — you can plan with it and hand the specs to
any orchestrator. See [Planning](#planning).

### Then, in each project

```bash
crew init
```

```bash
crew doctor
```

With machine-wide hooks in place, that leaves behind:

| path | what it is | yours to edit |
|---|---|---|
| `.claude/crew.config.json` | what this project is, and how to prove it | **yes** |
| `.claude/crew/project.md` | the rules a plausible diff can violate | **yes** |
| `.claude/tasks/` | where specs and the board live | state |
| `.claude/plans/` | the planning manifest and its maps | state |
| `.claude/crew/crew.config.schema.json` | so an editor resolves `$schema` | no, refreshed |
| `.claude/settings.json` | the `PreToolUse` scope hook | merged into |

**Two files are the whole per-project setup.** Everything else is state or a
refreshed copy. `project.md` is where a project stops being generic: the
worker skill and the reviewer agent both include it, and neither mentions your
project by name.

`init` never overwrites a file you may have edited, so it is also the upgrade
path — re-run it after a `git pull` and your edits survive.

### Leaving parts out

```bash
crew init --list
```

```
config     .claude/crew.config.json — what this project is, and how to prove it
brief      .claude/crew/project.md — the rules a plausible diff can violate
tasks      .claude/tasks/ — where specs and the board live
schema     a local copy of the config schema, so an editor resolves $schema
hooks      the git hooks, and core.hooksPath
scope      the PreToolUse scope hook in .claude/settings.json
plans      the planning layer: .claude/plans/ and its manifest
template   a local copy of the task template, to edit for this project   [off by default]
```

```bash
crew init --without hooks,scope
```

```bash
crew init --only config,brief
```

`hooks` is skipped automatically when a global `core.hooksPath` already covers
the repository — `--only hooks` forces a local copy anyway. `plans` is skipped
when the planning plugin is not installed alongside crew. Use
`--without scope` if crew is installed as a plugin: the plugin ships its own
copy of that hook, and two copies means it runs twice for the same verdict.

> **Check `.gitignore` before you trust the scope hook.** A repo that ignores
> `.claude/*` with an allowlist keeps `settings.json` local, so the hook never
> reaches the worktree where it matters — and `crew doctor` cannot tell the
> difference between that and a hook that is working.

### Without the global step

`crew init` on a machine with no global hooks path writes the hooks into
`.claude/crew/githooks` and points the repository's `core.hooksPath` at them,
exactly as before. Nothing about the global scope is required.

### Optional: the memory graph

[claude-memory-graph](https://github.com/StuCM/claude-memory-graph) is used if
it is installed and degrades silently if it is not. See
[The memory graph](#the-memory-graph).

## Slash commands

Plugin skills are namespaced by the plugin, so the four orchestrator skills are
`/crew:<name>`. They also trigger from their descriptions — asking "spec this"
or "where do things stand" reaches the same place without typing a command.

| command | who runs it | what it does |
|---|---|---|
| `/crew:crew-spec` | you + orchestrator | discuss the task, prime from the graph once, write the spec, **stop for your approval** |
| `/crew:crew-run` | orchestrator | check collisions, cut the worktree, hand the task to its own session, then stop |
| `/crew:crew-status` | orchestrator | render the board; what is waiting on you, what is in flight, what to pick up |
| `/crew:crew-close` | orchestrator | verify the gate stamp, **stop for your approval**, merge, write the graph, deploy or queue |
| `crew-worker` | the task session | not for you to invoke — it is the brief `/crew:crew-run` hands over |
| `crew-reviewer` | the task session | a read-only agent, spawned by the worker after the gate passes |

The two skills you never call yourself are the point of the design: the worker
owns its loop from handover to verdict, and the reviewer is spawned by the
worker, not by you.

With the planning plugin installed there is one more command,
`/claude-crew-planning:plan-init`, plus six skills that trigger by asking —
"map this conversation", "let's work through the open threads", "turn the plan
into tasks". See [Planning](#planning).

## CLI commands

| | |
|---|---|
| `crew init` | install into a repository; safe to re-run |
| `crew init --global` | the git hooks once, for every repository on the machine |
| `crew init --list` | the sections, and how to leave one out |
| `crew doctor` | is this installation actually wired up? |
| `crew spec-template` | the task template, for a new spec |
| `crew graph <what>` | read the memory graph: `prime`, `prefs`, `traps`, `find` |
| `crew collisions <task>` | unmerged branches already touching its `files:` |
| `crew preflight [env]` | what this machine can and cannot prove |
| `crew plan [task\|part]` | the plan map slice bearing on a task: its boundaries, symbols and neighbours |
| `crew gate <task>` | prepare + scope + verify, then stamp the commit |
| `crew gate --check <task>` | has the gate passed on the code that is here? |
| `crew scope <task> [base]` | changed files against the spec's `files:` |
| `crew review <task>` | open a round, refusing one past the limit |
| `crew board` | render `BOARD.md` from the task files |
| `crew log <task> <event>` | append one line to the cost log |
| `crew commit-msg <file>` | the commit convention (git hook) |
| `crew pre-commit` | staged-file format and lint (git hook) |
| `crew hook scope` | PreToolUse: refuse a write outside `files:` |

## Configuration

One file, with a schema:

```json
{
  "$schema": "./crew/crew.config.schema.json",
  "project": "Reflex",
  "verify": "npm run verify",
  "prepare": ["npm run fixture"],
  "environments": {
    "laptop": { "proves": ["browsing", "the guard", "the merge"] },
    "tv": {
      "proves": ["decode", "HLS", "audio over ARC"],
      "reachableFromAgents": false,
      "note": "Only a person at the panel can clear this."
    }
  }
}
```

`project` and `verify` are the only required keys; everything else has a
default that gives a working loop. `crew doctor` validates it and reports
every fault at once.

**Statuses are derived, not listed.** Six are intrinsic — `draft`, `approved`,
`building`, `review`, `blocked`, `done` — and every environment with
`reachableFromAgents: false` earns one of its own: the config above produces
`pending-tv`. That is how code-complete work is stopped from calling itself
done, without the board knowing what a TV is.

**Prose does not go in the JSON.** `.claude/crew/project.md` holds the rules a
plausible diff can violate, the files where being wrong is expensive, and what
this environment cannot prove. The worker skill and the reviewer agent both
include it, and neither mentions your project by name. That split is not
tidiness: the old roles had a project's runtime constraints written into them
and went stale against a migration they could not see, while the generic half
never would have.

## A first task, end to end

```bash
crew doctor                # everything wired?
```

Then, in Claude Code:

```
/crew:crew-spec add the retry banner to the player
```

You and the orchestrator settle what changes, which files, and what done
means. It writes `.claude/tasks/001-retry-banner.md` and **stops**. You read
it and say yes, which sets `status: approved`.

```
/crew:crew-run 001
```

It checks the board and `crew collisions`, cuts a worktree, and hands the task
to its own session with a one-line brief. Then it stops — no polling, no
narration.

That session implements inside `files:`, commits, runs `npx crew gate`, and
opens a review round with `npx crew review`, spawning `crew-reviewer` itself.
It writes its own verdict back into the task file.

```
/crew:crew-status
```

When the task reads `done`:

```
/crew:crew-close 001
```

Which checks the gate stamp still holds, shows you the diff and the verdict,
and **stops** for the second approval before it merges.

## Planning

Upstream of `/crew:crew-spec` is **`claude-crew-planning`**, the second plugin
in this marketplace. Six skills that turn a conversation into agent-ready work:

| skill | what it does | needs a repo |
|---|---|---|
| `brainstorm-map` | a planning chat becomes a map of what was decided, ruled out, corrected and left open | no |
| `architecture-map` | the parts that implies, how they connect, and what each is explicitly *not* | no |
| `feature-map` | the slice of an existing codebase a feature meets, every symbol verified against the file | **yes** |
| `open-threads` | works the unresolved parts as a conversation, and writes the outcome back | no |
| `agent-tasks` | task packets in dependency order — **refuses** anything unresolved | no |
| `taiga-mirror` | crew task state pushed to Taiga as a read-only board | no |

Layout is computed by Python, never emitted by a model, and the validator
refuses a node with no evidence quote, a rejected route with no stated reason,
or a symbol claimed without a real `file:line`.

### Where it meets crew

**`agent-tasks` is a pre-stage of `/crew:crew-spec`, not a peer.** It writes
`status: draft` specs with `files:`, Approach and Out of scope already lifted
from the maps, and deliberately does not run `crew collisions`, prime the
graph, or choose `model:`. It removes the blank-page work, not the gate.

**The orchestrator reads the plan at spec time** and records which part a task
builds in the spec's `part:`.

**The worker and the reviewer read the same part**, through `crew plan`:

```bash
npx crew plan .claude/tasks/007-mermaid-writer.md
```

```
Build script  [extend]  in the feature map — Arches 3D viewer

  Purpose     Reads the map JSON, validates it, writes the HTML.
  Why here    This is where the new output format hangs.
  Where       scripts/build_map.py

  Changing:
    modify   main  scripts/build_map.py:71
             Add a --format {html,mermaid,both} argument and branch after validation.
  Using — do not change these:
    call     build  scripts/build_map.py:8
             Untouched. The Mermaid path is a sibling of this call.

  Connected to:
    → depends "validates first" Validator
      The export must sit behind the gate, not beside it.
    ← depends "documents"       Skill instructions
```

The spec already carries the part's own purpose and boundaries. What it cannot
carry is the **neighbourhood**, and that is what keeps a worker on track: the
commonest drift is not writing the wrong code, it is writing the right code in
the wrong part, because the neighbour it belonged in was never in front of it.
The reviewer checks the diff against the same `not` list, which catches
behaviour in a permitted file that a diff alone cannot.

Workers stay hermetic — this reads JSON in the repo, no MCP and no network.
The map is a **reference, not an authority**: where it and the code disagree,
the code wins and the spec is wrong.

An open question printed on a part stops the worker. It should never get that
far — `agent-tasks` refuses to emit a task for a part with one — so it means
the gate was bypassed or the map moved on afterwards.

### The maps are not a second memory

One-directional by design. The maps are the working surface for one piece of
work; the memory graph is the durable record. At close,
`planning/scripts/graph_propose.py` turns confirmed decisions and ruled-out
routes into proposed Patterns and Constraints — it proposes, the orchestrator
commits, because one writer is still one writer. Once those have landed the
maps are disposable. Two stores drift, and a drifting store gives bad advice.

### Not everything earns a map

Route on blast radius, not on the word "bug" or "feature". One file with a
known cause goes straight to `/crew:crew-spec`. Work that crosses a boundary,
or a bug nobody can yet scope, earns a map — a bug whose fix nobody can scope
is a planning problem wearing a bug's clothes.

## Why it is arranged this way

**The orchestrator is the main session, not a subagent.** A subagent cannot
talk to you, so making the manager one adds a relay hop and doubles the context
carried. The main loop already has the conversation, spawns agents, and merges.

**The spec is the token optimisation.** An agent dropped into a repo with a
vague task burns tens of thousands of tokens rediscovering what you already
knew — once per agent, per task. A spec naming files, call sites and a
definition of done removes that cost from every downstream agent.

**Anything that can be a script is a script.** The commit convention, the scope
check, the build, the environment ceiling, the round limit — none of these need
a model. Every rule moved out of prose and into the CLI is a rule no agent ever
pays to read again, and one it cannot decide to skip.

**The reviewer cannot edit.** An agent that can fix will fix instead of review,
and you lose the independence you spawned it for.

**Rounds are counted, not requested.** "Two rounds, then a human" held exactly
as well as the worker felt like holding it. `crew review` is a counter.

**`status: done` is not evidence.** The gate stamps the commit it passed on, and
`crew gate --check` reports whether anything but bookkeeping has landed since.
A worker that skipped the gate, or gated four commits ago, cannot be closed by
accident.

**Scope is refused, not reported.** The PreToolUse hook denies a write outside
`files:` when it happens, rather than the gate reporting it after a round has
been paid for. It fails open on anything it cannot judge — no task identifiable,
no `files:` list, a path outside the repository — because a hook that stops the
orchestrator gets switched off.

**One graph writer.** Workers and reviewers *propose* triples in the spec; only
the orchestrator commits them. Parallel worktrees cannot race.

**One orchestrator role, many chats.** A 200-message session holds reasons
badly — the context fills and the early decisions are compressed away. State
lives in the task files, the board and the graph, all of which survive a new
session. A chat per feature or bug, primed from the repo and the graph, is the
shape that works.

## The memory graph

Uses [claude-memory-graph](https://github.com/StuCM/claude-memory-graph) if it
is installed, and degrades silently if not.

The orchestrator queries **once**, at spec time, and inlines what matters into
the spec. Workers never query. That is one query per task instead of one per
agent, filtered by judgement, and it keeps workers hermetic — no MCP, no
network, no dependence on a store that may not exist in CI or a container.

Traps are the highest-value writes. *"A 403 here is the agent proxy, not the
app"* recorded once stops every future agent chasing it.

## The cost log

`crew log` appends one JSON line per task event — id, model, env, rounds,
declared files, commits. The whole system is an argument that a specified task
costs less than an unspecified one, and until now nothing measured it, so
nothing could have contradicted it.

## What this deliberately does not use

A hook framework. The scope hook is ~40 lines over the task parser the CLI
already has, and the frameworks worth considering solve a different problem:
[`claude-hook-kit`](https://github.com/StuCM/claude-memory-graph/tree/main/hook-kit)
is Python, has no `PreToolUse` in its event map, and always exits 0 with stdout
treated as injected context — so a `permissionDecision` returned through it
would reach the model as prose rather than deny the write. Its session state
and `Stop`/`PostToolUse` events are the right home for *recording* what a task
cost; they are not a way to refuse one.

## Not done yet

- **Nothing has run end to end on real work.** Every part is tested in
  isolation; the chain from a planning conversation to a merged task has not
  been walked once. The next useful thing is to do that on one real piece of
  work and note every place you had to intervene.
- **Taiga status names are conventional guesses.** `New` / `Ready` /
  `In progress` / `Ready for test` / `Done` vary by instance, and a status
  that does not exist fails the push quietly. Check them before the first run.
- **Nothing is published yet.** `npm publish` for the CLI, and the plugin
  marketplace assumes `StuCM/claude-crew` is pushed and public.

## Contributing

This is a Node CLI. It runs on your machine and in CI, **never in a browser and
never in whatever runtime the host project targets** — so it is written in
modern JavaScript and pinned to `node >= 20.11`. The host project's own
constraints are the host project's; this said nothing about its runtime and got
written in ES5 by contagion, which is the reason this paragraph exists.

```bash
npm test
```

The tests are the arbiter for the parsing, the matching and the hook decision.
Two of them are worth knowing about before changing anything:

- `test/git.test.js` runs a shell-injection payload through a real repository
  **with a control** that proves the payload fires when it does reach a shell.
  Every git call is an argv array for that reason: a `files:` entry of
  `src/x.ts$(touch /tmp/pwned)` in an agent-written spec used to execute.
- `test/scope-check.test.js` pins the comment ratio to code files. The old
  counter scanned the raw diff, so Markdown headings and list bullets counted
  and any task touching a doc tripped the warning it had not earned.
