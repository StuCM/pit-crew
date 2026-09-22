---
name: taiga-mirror
description: Mirror crew task state into Taiga as a human-readable board — status, blocked flag, branch and environment attributes, and a comment at the moments a person has to act. One way only; the task files stay the source of truth. Use when the user wants crew work reflected in Taiga, asks to update or sync the board or the tickets, or wants to see progress somewhere other than the terminal.
---

# Taiga mirror

crew's task files are the truth. Taiga is a view of them for people who are not
in the terminal — a colleague, a client, you on a phone.

**One way.** Nothing here reads Taiga back, and nothing in crew waits on it.
If a card is dragged in Taiga, the next status change overwrites it. That is
the deal: two writers means two truths, and the merge problem the board was
built to avoid comes back.

If the push fails, say so and carry on. The loop must never stall on a
reporting layer, for the same reason the memory graph degrades silently.

## The config

`.claude/taiga.json` controls how work is written. Create one with:

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/taiga-mirror/scripts/taiga_layout.py --init
```

| Key | Values | Meaning |
|---|---|---|
| `project` | slug | which Taiga project |
| `board` | `kanban` · `scrum` | must match the project's own setting — the mirror cannot change it |
| `sprint` | `none` · `current` · a name | scrum only |
| `structure` | `auto` · `tasks` · `stories` · `epics` | how a plan is broken down |
| `crewUnit` | `auto` · `story` · `task` | which Taiga level a crew task updates |
| `statuses` | crew status → Taiga status name | override the conventional names |
| `comments` | which moments get a comment | default: building, blocked, pending, done |
| `attributes` | frontmatter keys to copy | default: branch, env, model, rounds |

### `structure: auto`

Reads the plan instead of asking:

- **a feature into a live system** — a feature map where existing parts
  (`exists`, `extend`) outnumber new ones — becomes **one story with tasks**
- **a build** — mostly new work across several areas — becomes **epics from
  the areas, stories from the parts, tasks from the changes**
- mostly new work in a single area becomes **stories with tasks**

Always run `--explain` first and show the user what it chose and why. It is a
default, and the user knows things about the work the plan does not.

Areas whose only parts are `open` or `deferred` produce no epic. They are not
work yet, and an empty epic on a board looks like forgotten work.

### `crewUnit`

The level a crew task's status lands on. With `auto`, it is `task` when the
structure is `tasks` and `story` otherwise. Getting this wrong means the mirror
updates a parent while the work happens in a child, and the board lies.

### Board and sprint

`board` must match how the Taiga project is actually configured — the mirror
cannot switch a project between scrum and kanban. The layout refuses two
mistakes rather than failing quietly: a sprint on a kanban board (kanban has no
sprints), and scrum with no sprint (stories silently land in the backlog).

## Creating the structure

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/skills/taiga-mirror/scripts/taiga_layout.py plan.json --explain
python3 ${CLAUDE_PLUGIN_ROOT}/skills/taiga-mirror/scripts/taiga_layout.py plan.json
```

The second prints items in **creation order** — epics, then stories, then
tasks — each naming its `parent` by key. Create them with the MCP in that
order, keeping a map from key to the Taiga id each returns, so children can be
attached to parents that now exist.

Items with `"blocked": true` carry open questions. Create them with
`is_blocked` set and the questions as the note, never as ordinary work.

## When to push

At the moments the orchestrator already acts, not on a timer:

| Moment | crew status | Taiga |
|---|---|---|
| spec written | `draft` | New |
| approved | `approved` | Ready |
| dispatched | `building` | In progress **+ comment** |
| rounds running | `review` | In progress, silently |
| rounds disagreed | `blocked` | In progress, `is_blocked` **+ comment** |
| code-complete, unprovable here | `pending-<env>` | Ready for test **+ comment** |
| closed | `done` | Done **+ comment** |

`pending-<env>` is derived from the config, not hardcoded — any environment
with `reachableFromAgents: false` earns one. Do not collapse it into Done. That
status exists precisely because a loop that marks unproven work done is lying,
and the mirror must not undo that.

## Comments, sparingly

Four comments in a task's life: dispatched, blocked, pending, closed. That is
it. `review` moves the card and says nothing.

Mirroring every event is how a board becomes noise, and a noisy board gets
ignored — at which point the blocked comment nobody reads is the one that
mattered. Comment when a human has something to do.

## Workflow

1. Compute the payload. It is deterministic, so do not assemble it by hand:

   ```sh
   python3 ${CLAUDE_PLUGIN_ROOT}/skills/taiga-mirror/scripts/mirror_payload.py \
     .claude/tasks/007-thing.md
   ```

   It returns `action` (`create`, `update` or `none`), the mapped status, the
   attributes, and a `comment` — which is `null` unless one is due.

2. `action: none` means nothing changed since the last push. **Stop.** Do not
   re-comment.

3. Otherwise use the connected Taiga MCP to create or update the story. Set
   the custom attributes `branch`, `env`, `model` and `rounds` so the board is
   filterable; without them a card cannot tell you which worktree it is in.

4. Record what happened, so the next run knows:

   ```sh
   ... mirror_payload.py <task> --set-ref <story ref>   # after a create
   ... mirror_payload.py <task> --mark-synced           # after any push
   ```

   These write `taiga:` and `taigaSynced:` into the task frontmatter. That is
   where the mirror keeps its state — in the file it mirrors, not a side
   database that can drift from it.

## Judgement calls

**No Taiga MCP connected?** Say so once and stop. Do not fall back to a CSV
mid-loop; that produces a second, stale board.

**A task with no `taiga:` ref** gets created on first push. If `agent-tasks`
already created the story, record the ref with `--set-ref` before the first
status change, or you will get a duplicate.

**Status names are instance-specific.** The mapping above uses conventional
Taiga names. Check them against the project's workflow before the first run and
adjust the table in `mirror_payload.py` — a status that does not exist fails
the push, and the loop will carry on without it silently.

**Do not mirror the spec body into the description on every update.** Write it
once at creation. It is long, it rarely changes, and re-pushing it buries the
comments.
