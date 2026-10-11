---
name: crew-run
description: Hand an approved task to its own session in an isolated worktree. Use when the user says "run task N", "start building it", or approves a spec.
---

# Handing a task to a session

Refuse to start unless `status:` is `approved`. A `draft` goes back to
`/crew:crew-spec` — the approval gate is the point of the whole system.

Each task gets **its own session and its own worktree**. The orchestrator does
not implement, does not review, and does not watch. It hands over, then reads
the board.

A task can also be queued from `crew serve`: its id appears under `requests`
in `.claude/crew/wall.json`. Treat that as the person saying "run task N",
and remove the entry once it is dispatched. A task started from the
`pit-wall` pane has already been dispatched: its status is `building`, and
there is nothing for you to do but read the board.

## 1. Dispatch it

```sh
npx crew dispatch <id>
```

It does everything here that never needed a model, in one place, so the
skill, the pit wall and the pane cannot drift apart:

- refuses unless `status:` is `approved`;
- refuses if another in-flight task declares any of the same `files:`, or an
  unmerged branch already carries commits touching them (`crew collisions`);
- cuts `<worktreeDir>/<project>-<id>` on the task's `branch:` from the base
  branch — the branch name matters, the scope hook identifies the task by it;
- copies the spec into the worktree if it was never committed;
- sets `status: building`, re-renders the board and logs the dispatch;
- prints the session's model and the exact command to start it.

**On a refusal, do not dispatch.** Name the task or the branch and its
commits, and offer to land them, respec around them, or proceed anyway. The
user may say proceed — then `npx crew dispatch <id> --force`. You may not
decide it for them, exactly as with a `draft`.

## 2. Hand over

Start the session in that worktree with exactly the brief `dispatch` printed
— nothing more:

```
Use the crew-worker skill for task .claude/tasks/<id>-<slug>.md.
You are in a worktree; the spec is the brief.
```

No conversation summary, no context dump. If the session needs something, it
belongs in the spec — that is the artifact that gets reused, and re-explaining
in a prompt is exactly the cost this system exists to remove.

**Start it on the task's `model:`.** The spec chose it — `models.default` for
well-specified work, `models.critical` for the code the brief says must not be
wrong — and nothing else carries that choice to the session. A session that
starts on whatever the machine defaults to spends the critical model on a
rename, or the cheap one on the code that must not be wrong.

**In the Claude desktop app, queue the task's card.** If
`mcp__ccd_session__spawn_task` is available, run
`npx crew dispatch <id> --json` instead and pass its `card` — `title`,
`tldr` and `prompt`, verbatim — to `spawn_task`. One click on the card
starts the task's session on this machine. The card's prompt moves that
session into the worktree first and names the spec's model, because a card
can set neither. Tell the user in one line that the card is there and to
start it on their machine, not in a fresh worktree.

If another tool for spawning a session is available, spawn it there with
the brief and the model, and record the session id in the task file's
`session:`. Otherwise give the user the one line `dispatch` printed to
paste, or tell them to open a new session in the worktree folder on that
model with that brief.

## 3. Mirror it, if the project has a board

If `.claude/taiga.json` exists, use the `taiga-mirror` skill to move the card
to In progress with a dispatch comment. One way only, and never a blocker: if
the push fails, say so in a line and carry on. The loop must not stall on a
reporting layer, for the same reason the graph degrades silently.

## 4. Then stop

The task session owns the loop from here: it implements, runs the gate, opens
its rounds with `crew review`, spawns `crew-reviewer` itself, and writes its
own status back into the task file.

**Do not poll it and do not narrate it.** Re-render the board when the user
asks where things stand, or when a session reports back.

## 5. When a session reports

The task file's `status:` tells you what happened:

- `review` → still going. Leave it.
- `done` → the gate and review passed. Go to `/crew:crew-close`.
- `pending-<env>` → code-complete, and only that environment can prove it. Tell
  the user what to check. The loop cannot clear this and must not pretend to.
- `blocked` → the rounds disagreed, or the spec could not be judged. Put the
  disagreement in front of the user in a few lines and let them settle it.
  Do not spawn another round to break the tie.

Re-render the board after any status change.
