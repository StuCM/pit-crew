# crew

A task loop for coding agents. An approved spec, a worker in its own worktree,
a deterministic gate, and an independent review that cannot edit.

Project-agnostic: everything specific to a repository lives in two files it
owns — `.claude/crew.config.json` for the mechanics and
`.claude/crew/project.md` for the rules a wrong diff can satisfy.

## The shape

```
YOU + ORCHESTRATOR (the main session — not an agent)
  /crew:crew-spec    discuss → query the graph once → write the spec → YOU APPROVE
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

There are two halves, and you can run either without the other. The **npm
package** is the CLI that the git hooks and CI call — it works with no Claude
Code at all. The **plugin** adds the four skills and the reviewer agent.

### 1. The CLI, into a repository

```bash
npm install --save-dev @stucm/crew
```

```bash
npx crew init --hook
```

```bash
npx crew doctor
```

`init` writes, and never overwrites, the files you may have edited:

| path | what it is |
|---|---|
| `.claude/crew.config.json` | the mechanics — project, verify, scopes, environments |
| `.claude/crew/project.md` | the rules a plausible diff can violate |
| `.claude/crew/templates/task.md` | the spec template, yours to edit |
| `.claude/tasks/` | where specs and the board live |

and refreshes the files crew owns on every run — the config schema and the git
hooks in `.claude/crew/githooks/`, with `core.hooksPath` pointed at them. That
split is what makes `init` the upgrade path as well as the installer: re-run it
after `npm update` and your edits survive.

`--hook` adds the `PreToolUse` scope hook to `.claude/settings.json`. If crew
is installed as a plugin you can skip it — the plugin ships its own copy.

> **Check `.gitignore` before you trust the scope hook.** A repo that ignores
> `.claude/*` with an allowlist keeps `settings.json` local, so the hook never
> reaches the worktree where it matters — and `crew doctor` cannot tell the
> difference between that and a hook that is working.

If `core.hooksPath` is already set to something else, `init` says so and leaves
it alone rather than taking over.

### 2. The plugin, for the skills

```
/plugin marketplace add StuCM/claude-crew
```

```
/plugin install crew@claude-crew
```

To try it before committing to it:

```bash
claude --plugin-dir /path/to/claude-crew
```

### 3. Optional: the memory graph

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

## CLI commands

| | |
|---|---|
| `crew init [--hook]` | install into a repository; safe to re-run |
| `crew doctor` | is this installation actually wired up? |
| `crew spec-template` | the task template, for a new spec |
| `crew graph <what>` | read the memory graph: `prime`, `prefs`, `traps`, `find` |
| `crew collisions <task>` | unmerged branches already touching its `files:` |
| `crew preflight [env]` | what this machine can and cannot prove |
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
npx crew doctor            # everything wired?
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
in this marketplace: evidence-traced maps of a piece of work — a brainstorm map
from the conversation, an architecture map of parts and connections, a feature
map whose symbols are verified against real files — and a gate that refuses to
emit a task while a question on it is still open.

```
/plugin install claude-crew-planning@claude-crew
```

It installs on its own. You can plan with it and hand the specs to any
orchestrator, or run crew with no planning layer at all.

It is one-directional by design. The maps are the working surface for a piece
of work; the memory graph is the durable record. Confirmed decisions and dead
ends land in the graph, and the maps become disposable once they have, so crew
keeps querying one store rather than two that drift.

> **Status:** the planning plugin is built but the crew-side seam is not. See
> [Not done yet](#not-done-yet).

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

- **The planning seam.** `/crew:crew-spec` does not read plan maps, the task
  template has no field pointing a worker at the diagram it is building
  against, and `crew init` does not scaffold a plans directory. The planning
  plugin's `agent-tasks` emits crew specs today, but they arrive as `draft`
  with `Graph context` marked as coming from the maps rather than the graph.
- **The Taiga mirror.** The planning plugin carries a `taiga-mirror` skill, but
  nothing in crew calls it. It belongs beside `crew log` in this package — a
  skill copy in a project would be overwritten by the next `crew init`.

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
