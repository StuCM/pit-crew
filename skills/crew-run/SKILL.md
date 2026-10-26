---
name: crew-run
description: Hand an approved task, or an approved group of them, to its own session in an isolated worktree. Use when the user says "run task N", "run the <slug> group", "start building it", or approves a spec.
---

# Handing a task to a session

Refuse to start unless `status:` is `approved`. A `draft` goes back to
`/crew:crew-spec` — the approval gate is the point of the whole system.

Each task gets **its own session and its own worktree**. The orchestrator does
not implement, does not review, and does not watch. It hands over, then reads
the board.

## A group

"Run the `<slug>` group" means every approved task with `work: <slug>`, in
the card's order (`npx crew work <slug>` lists them).

- **With a pilot** (`★ pilot` on the card): dispatch the pilot alone. When
  it reaches `done`, or `pending-<env>`, stop and ask the person to look at it
  before the rest go: the pilot exists so a wrong approach costs one task.
  Dispatch refuses the others until the pilot is done. Do not pass `--force`
  to get round it unless the person says so.
- **Without one**: dispatch them in order, each through the steps below,
  holding back any that collides with one already in flight.

A task dispatch refuses as held by an open question waits for the person's
answer. Say which question, and carry on with the rest.

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

**Run it as a background Agent.** Workers are not meant to be intercepted:
the spec is the brief, the gate and the reviewer are the checks, and the
person steps in at the merge. Spawn the Agent tool with `run_in_background:
true`, `model` set to the task's `model`, and this prompt — `brief`, then
three lines, nothing else:

```
<brief>
Your worktree is <worktree>. Your shell starts elsewhere: run every command as `cd <worktree> && ...` and use absolute paths under it for every Read, Edit and Write. Keep to `files:` yourself; the scope hook cannot see your branch from here.
Spawn crew-reviewer in the foreground and wait for its verdict. Do not hand back with a round open.
Finish by committing the task file on the branch, then `git switch --detach`.
```

Then stop. You are told when the Agent finishes; read the task file on its
branch (`git show <branch>:<task file>`), not the Agent's report, for the
status — a report has said `done` over a file that still said `review`.

Queue `card` with `mcp__ccd_session__spawn_task` instead only when the person
asks to watch or steer the task in its own chat, and give `command` to paste
only when they ask for a terminal.

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
- `blocked` → its `blocked-by:` says who stopped it and `blocked:` says why,
  in one line. Lead with that line, then the detail from **Review rounds**,
  and let the user settle it. Do not spawn another round to break the tie.
- `blocked` with `blocked: question: …` → the reviewer doubts the group's
  approach. Show `npx crew work <slug>`, which lists the question, its
  evidence and the tasks it holds. Ask it as it stands, without arguing for
  the current plan: agreeing too quickly is the failure this exists to
  catch. Record the answer with `npx crew work <slug> answer r<n> "<answer>"`.
  If the approach holds, `npx crew task <id> sendback`. If it changed,
  update the brief and the affected tasks first, then send back. Dispatch
  refuses the held tasks until the question has an answer.

Re-render the board after any status change.
