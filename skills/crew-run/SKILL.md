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

## 1. Check it can run alongside what is already in flight

Read the board. If another in-flight task declares any of the same `files:`,
**do not start this one** — say which task it collides with and offer to queue
it. Two sessions editing the same module will conflict at merge and you pay for
both.

Git's half of the question — unmerged branches already carrying commits on
these files — is asked by the dispatch itself in step 2.

## 2. Worktree

```sh
npx crew dispatch <id> --json
```

It cuts `<worktreeDir>/<project>-<id>` on the task's `branch:` from the base
branch (the scope hook identifies the task from that branch), copies in the
crew config, the project brief and an uncommitted spec, sets `status:
building` in the **worktree's** copy only, and runs `crew board` and
`crew log <task> dispatch`.

If it refuses with `collisions`, an unmerged branch already touches these
files. **Do not dispatch.** Name the branch and the commits, and offer to land
them, respec around them, or proceed anyway. The user may say proceed — then
pass `--force` — but you may not decide it for them, exactly as with a `draft`.

## 3. Hand over

The JSON carries `brief`, `model`, `worktree`, `command` and `card`. The brief
is exactly this, and nothing more is added to it:

```
Use the crew-worker skill for task .claude/tasks/<id>-<slug>.md.
You are in a worktree; the spec is the brief.
```

No conversation summary, no context dump. If the session needs something, it
belongs in the spec — that is the artifact that gets reused, and re-explaining
in a prompt is exactly the cost this system exists to remove.

**The task runs on its `model:`.** The spec chose it — `models.default` for
well-specified work, `models.critical` for the code the brief says must not be
wrong. A session on whatever the machine defaults to spends the critical model
on a rename, or the cheap one on the code that must not be wrong.

If `mcp__ccd_session__spawn_task` is available, pass it `card` — its `title`,
`tldr` and `prompt`, verbatim — and tell the person in one line that the card
is in the app. Its prompt moves the chat into the worktree and onto the model
before the brief. Otherwise give the person `command` as the one line to
paste.

Use a background Agent only when the person asks for it ("just run it"). Its
brief must then also say to spawn `crew-reviewer` in the foreground and wait
for the verdict, or the verdict comes back to you instead of the worker.

## 4. Mirror it, if the project has a board

If `.claude/taiga.json` exists, use the `taiga-mirror` skill to move the card
to In progress with a dispatch comment. One way only, and never a blocker: if
the push fails, say so in a line and carry on. The loop must not stall on a
reporting layer, for the same reason the graph degrades silently.

## 5. Then stop

The task session owns the loop from here: it implements, runs the gate, opens
its rounds with `crew review`, spawns `crew-reviewer` itself, and writes its
own status back into the task file.

**Do not poll it and do not narrate it.** Re-render the board when the user
asks where things stand, or when a session reports back.

## 6. When a session reports

The task file's `status:` tells you what happened:

- `review` → still going. Leave it.
- `done` → the gate and review passed. Go to `/crew:crew-close`.
- `pending-<env>` → code-complete, and only that environment can prove it. Tell
  the user what to check. The loop cannot clear this and must not pretend to.
- `blocked` → the rounds disagreed, or the spec could not be judged. Put the
  disagreement in front of the user in a few lines and let them settle it.
  Do not spawn another round to break the tie.

Re-render the board after any status change.
