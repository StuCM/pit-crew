---
name: agent-tasks
description: Turn a finished plan into task packets an agent can work from — goal, files, approach with named symbols, out of scope, and definition of done, in dependency order. Refuses to emit a task for anything still unresolved or unverified. Exports as markdown, as crew task specs, as Taiga user stories, or any format you add. Use when the user wants to generate tasks, tickets, issues or work packets from a plan, hand work to agents or an orchestrator, or asks what to build first.
---

# Agent tasks

The last layer. Everything upstream exists so this one can refuse to guess.

```
brainstorm-map → architecture-map → feature-map → open-threads → agent-tasks
```

## The gate

**A part with unresolved questions or unverified symbols does not become a
task.** It becomes a blocker, printed with its reasons, and the run reports
`N ready, M blocked`.

This is the whole point of the pipeline. An agent handed a task built on an
open question will make the decision itself, silently, in code — and you will
find out three tasks later. Blocked items go to `open-threads` (for questions)
or back through `feature-map --repo` (for unverified symbols).

`--force` writes them anyway with the blockers attached. Use it to see the
shape of the work, not to dispatch.

**Verification must be persisted first.** `verified` is set when a feature map
is built against a repo, and unless `build_feature.py --write-back` was used it
lives only inside the rendered HTML. Without it every symbol reads as
unverified here, and everything blocks. If a whole plan blocks on unverified
symbols, check that before anything else.

## What a packet contains

Nothing invented. Every field is lifted:

| Field | Comes from |
|---|---|
| Goal | the part's `purpose` |
| Why | `why_here`, or the architecture part's `why_split` |
| Files | `where` plus every `file` in `surface` |
| Approach | `surface` — changing symbols become steps with their `change` line, file and symbol name |
| Constraints | `surface` entries marked USING, so the worker knows what not to touch |
| Out of scope | the part's `not`, the architecture part's `not`, and every other task |
| Done when | the `change` lines, plus `purpose` for a new part |
| Traces | back to the maps and the chat |

If a field is thin, the map is thin. Fix it there rather than padding here.

## Ordering

Dependency order from the feature map's edges: `depends` and `data` mean the
target should exist first. Tasks come out in a buildable sequence, numbered.

## One session per task

A packet an agent cannot finish in one session gets half-done. Split when a
task touches more than about five files, spans two parts, or has more than
six approach steps. Splitting is done in the **feature map** — split the part —
not here, so the split is visible on the diagram.

## Formats

```bash
python3 scripts/build_tasks.py plan.json --check              # gate only
python3 scripts/build_tasks.py plan.json -o tasks/            # markdown
python3 scripts/build_tasks.py plan.json -o tasks/ --format crew
python3 scripts/build_tasks.py plan.json -o tasks/ --format markdown,crew,taiga
```

- **markdown** — `tasks.md`: a summary table, the held-back list, then one
  section per task. The least-ceremony format for handing to an LLM.
- **crew** — `tasks/crew/NNN-slug.md`, matching the `.claude/tasks/` spec shape:
  frontmatter with `files:` as a scope contract, Approach, Out of scope,
  Definition of done. Emitted as **`status: draft`** deliberately — see below.
- **taiga** — a CSV for the bulk importer and JSON for the API. Column names
  vary between Taiga versions and self-hosted instances, so check them against
  yours before importing.
- **generic** — everything as JSON; read this before writing a new exporter.

### Pushing to Taiga directly

If a Taiga MCP is connected, **use it instead of the CSV**. The importer needs
a manual step and its column names differ between Taiga versions; the MCP
creates the stories in place and can set fields the CSV cannot.

The mapping, whatever the tools are called:

| Task field | Taiga |
|---|---|
| `title` | subject |
| the markdown body (goal, why, files, approach, out of scope, done) | description |
| `blockers` non-empty | `is_blocked` true, with the reasons as the blocked note |
| `status_in_map` | a tag |
| `n` | external reference, so a re-run updates rather than duplicates |

Generate with `--format generic` and read `tasks.json` — that is the full
record, and it is what an exporter receives. Then create one story per task
with the connected tools.

Two things to get right:

- **Check for an existing story by reference before creating one.** Re-running
  the build after a map changes is normal, and without this it duplicates the
  backlog.
- **Only push ready tasks.** Blocked ones are held back for a reason, and a
  blocked story in a backlog gets picked up by someone who did not read why.
  If the user wants them visible, push them with `is_blocked` set and the
  reasons in the note — never as ordinary work.

Ask which project and which status the stories should land in rather than
assuming; both are instance-specific.

### Adding a format

One file in `scripts/exporters/`, a `write(tasks, outdir, meta)` function
returning the paths it wrote, and one line in `EXPORTERS`. Nothing in
`build_tasks.py` changes.

## Handing to crew

Generated specs are `status: draft` and stay there. crew's approval gate is the
point of that system, and a spec assembled from maps has not been through it.
What the orchestrator still owns, and this skill does not touch:

- `npx crew collisions` on each file — the generator does not run git, and the
  **Existing work** section says so rather than pretending it was checked
- priming the memory graph and merging anything that bears on these files into
  **Graph context** — what is there came from the plan maps, which is a
  different source
- choosing `model:` — everything is emitted as the default; the project brief
  decides what must not be wrong
- getting the user to approve

So the flow is: generate drafts, then take each through `/crew-spec` for
collisions, graph and approval. The generator removes the blank-page work, not
the gate.

## Files

- `scripts/build_tasks.py` — gate, ordering, packet assembly
- `scripts/exporters/` — markdown, crew, taiga, generic
- `references/schema.md` — the task record, and how to write an exporter
