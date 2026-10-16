---
id: 012
slug: one-orchestrator-per-repo
status: done
branch: crew/012-one-orchestrator-per-repo
model: sonnet
env: laptop
rounds: 1
files:
  - src/commands/orchestrator.js
  - src/commands/hook-session.js
  - src/cli.js
  - test/orchestrator.test.js
  - test/hook-session.test.js
  - skills/crew-orchestrate/SKILL.md
  - skills/crew-spec/SKILL.md
  - skills/crew-run/SKILL.md
  - skills/crew-close/SKILL.md
gate: pass
gateSha: 06370de4b0fbf370c80ee020387134d340a04c23
gateAt: 2026-10-16T08:07:40.894Z
---

# One chat per repo is the orchestrator; every other chat knows it is a side chat

## Goal
A repo has at most one orchestrator chat, chosen explicitly by the person. A
chat that starts in the repo is told whether it is that orchestrator, a side
chat (and which chat is the orchestrator), or that none is set. Side chats send
work proposals to the orchestrator instead of numbering and speccing tasks
themselves. Task chats close once their task is merged.

## Why now
Several chats in one repo each acted as orchestrator and handed out the same
task numbers. Graph: Pattern "two orchestrators both took task id 021"
(arches-toolkit). Also this repo: tasks 011 and 012 were numbered by a chat
nobody had named orchestrator.

## Background
From the person:
- "I organise my groups by repo. In every repo one chat is the orchestrator.
  It should be named so and know itself it is the orchestrator. It will open
  the tasks as chats, and these should close once the task is completely done
  and merged. Any later chat I open in the group or repo should know it's a
  side chat. It sends what it wants to do back to the orchestrator chat, so
  the orchestrator can fit it in with current work and decide whether anything
  conflicts or won't work."
- A chat becomes the orchestrator **only when the person says so**. If work is
  happening and no orchestrator is set, the chat **suggests** it once.
- If no orchestrator is set, the chat mentions that, so the person knows.
- Side chats keep some freedom: they may make small inline edits themselves.
- A side chat **sends its proposal and carries on**. It does not wait for a reply.

## Assumed
- **Claim file.** It lives at `<git-common-dir>/crew-orchestrator.json`
  (`git rev-parse --git-common-dir`, resolved against `cfg.root`), so the main
  checkout and every worktree see the same one. It is not under `.claude/`,
  which is per-checkout. Contents: `{ "session": "<claude session_id>",
  "title": "Orchestrator · <project>", "claimed": "<ISO date>" }`.
- **How a chat knows its own id.** It comes from the SessionStart hook's stdin
  JSON `session_id` (Claude Code's hook contract). No crew code reads it yet.
  The hook passes that id into the context text, so the chat can run
  `crew orchestrator claim <id>`. No env var is needed.
- **No automatic expiry.** A stale claim stays until it is released or taken
  over with `claim --force`, and the side-chat text says how. Detecting a dead
  session is out of scope.
- **Addressing.** A side chat finds the orchestrator by its chat title, using
  the Desktop session tools (`list_sessions`, then `send_message`). The claude
  `session_id` and the Desktop session id are not assumed to be the same.
  Without those tools, the side chat gives the person the proposal to paste.
- **Task numbers.** No `crew task next` helper. Only the orchestrator numbers
  tasks, and the side-chat text forbids writing to `<tasksDir>`.
- A resumed chat keeps its `session_id`, so the orchestrator stays the
  orchestrator after a resume.

## Existing work
None.

## Graph context
- "two orchestrators both took task id 021" (arches-toolkit): the motivating
  failure. It shows that ids collide when two chats spec at once.
- "task-chip sessions are user-placed, not linked": a chat started from a
  spawn_task card has no `startedBy`, so do not rely on parent links to tell a
  task chat from a side chat. Use `session:` in the task file and the claim file.
- `archive_session` cleans up its worktree by default. It is untested for a
  worktree entered via EnterWorktree, so crew-close archives only after
  `git worktree remove` has run.

## Constraints that bite here
- `src/cli.js` hook wrapper (:80-89): the hook must never fail the session.
  A missing or unreadable claim, or bad stdin, means "no orchestrator set".
- Keep the early return in `hook-session.js`: a worker on a `crew/` branch
  hears nothing.
- Every git call goes through `git()` in `src/lib/git.js` as an argv array.

## Approach
1. `src/commands/orchestrator.js`: exports `claimPath(cfg)`, `readClaim(cfg)`
   (null on any failure) and `run(cfg, args)` for
   `claim <session-id> [--force]`, `show` and `release`.
   - `claim` refuses if another session holds the claim and `--force` is
     absent; it prints who holds it.
   - `claim` by the holder is a no-op success.
   - `show` prints the claim JSON, or `none`.
   - `release` deletes the file.
   - Register it in `src/cli.js` `COMMANDS` with one USAGE line.
2. `src/cli.js` hook-session branch: read stdin (non-blocking; empty if it is
   a TTY), parse JSON, and pass `session_id` to `run(cfg, args, input)`.
   Errors fall back to no id.
3. `src/commands/hook-session.js`: keep the worker return. Otherwise choose
   between three texts, each starting with the existing `CONTEXT`:
   - **orchestrator** (claim.session === id): "You are the orchestrator for
     <project>, titled <title>. Side chats will send you proposals: fit each
     against the tasks in flight, say plainly if it conflicts, and give it a
     task number only when it becomes a spec."
   - **side chat** (claim held by another id): "<title> is the orchestrator
     (claimed <date>). You are a side chat. Answer questions and make small
     inline edits (say you are doing so). Do not number tasks, write to
     <tasksDir>, or run crew-run/crew-close. For anything bigger, send the
     orchestrator a proposal (what, why, the files you think it touches) with
     the session tools, tell the person it was sent, and carry on. If that
     chat is gone, the person can make this one the orchestrator."
   - **none**: "No orchestrator is set for this repo. Mention this once when
     the person starts work that crew would spec. Suggest making this chat
     the orchestrator; do not claim it without being told."
   Every text carries "Your session id is <id>." when the id is known.
4. `skills/crew-orchestrate/SKILL.md` (new). Trigger: "become the
   orchestrator", "make this the orchestrator", "you're the orchestrator".
   Steps:
   - run `npx crew orchestrator claim <id>`. If it is refused, say who holds
     the claim and ask before `--force`;
   - rename the chat to `Orchestrator · <project>` with the session-title tool
     if it is available;
   - check in-flight tasks with `crew-status`.
   Also covers incoming side-chat proposals: read the proposal, check it
   against in-flight `files:`, then start a spec through crew-spec, park it
   as a draft stub, or reply with the conflict.
5. `skills/crew-spec/SKILL.md`: at the top, the role check. If the session
   context says this chat is a side chat, do not spec; send a proposal as the
   hook text describes. If no orchestrator is set, mention it once.
6. `skills/crew-run/SKILL.md` §3: open the task chat titled
   `Task <id> · <slug>` and record its id in the task's `session:`.
7. `skills/crew-close/SKILL.md`: after the merge and `git worktree remove`
   succeed, archive the chat in `session:` with the session-archive tool if
   it is available; otherwise tell the person which chat to close. Also, before the local merge
   block, one line (from task 011): the board reads the branch's copy until
   merge, so do not hand-edit the main checkout's task file first; the merge
   brings the worker's copy in, and a local edit makes `git merge` refuse or conflict.
8. Tests:
   - `test/orchestrator.test.js`, using `sandbox()`: claim, a refused second
     claim, `--force`, show, release, and a claim made in a linked worktree
     being visible from the main checkout.
   - `test/hook-session.test.js`: feed stdin `{"session_id":"a"}` and assert
     the orchestrator, side-chat and none texts. Keep the existing
     worker/non-crew test.

## Out of scope
- Detecting that the orchestrator chat has died, or a SessionEnd hook to
  release the claim.
- A `crew task next` id allocator.
- Showing the orchestrator on the pit wall or board.
- Task 011 (the board reading task branches).
- Changing how workers run, gate or review.

## Definition of done
- [ ] `crew orchestrator claim a` and then `claim b` exits non-zero and names
      `a`; `claim b --force` succeeds; `show` prints b; `release` then `show`
      prints `none`
- [ ] A claim made from a linked worktree is read from the main checkout
- [ ] The hook with stdin `{"session_id":"a"}` prints the orchestrator text
      when `a` holds the claim, the side-chat text naming the title when `b`
      does, and the no-orchestrator text when there is no claim
- [ ] The hook with empty or invalid stdin still prints the no-orchestrator
      text and exits 0; a `crew/` branch still prints nothing
- [ ] `skills/crew-orchestrate/SKILL.md` exists, and crew-spec, crew-run and
      crew-close carry the lines in Approach 5–7
- [ ] tests cover the above and fail if the claim or role check is removed
- [ ] the gate passes (`npx crew gate .claude/tasks/012-one-orchestrator-per-repo.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Scout requests

## Review rounds

Round 1: PASS. Gate passed (127 tests). Reviewer did not independently confirm that tests fail with the claim check removed.

Changed: orchestrator.js (claim file, claim/show/release); cli.js (registers command, reads hook stdin session_id); hook-session.js (three role texts); two test files; crew-orchestrate skill new; crew-spec, crew-run, crew-close carry Approach 5-7 lines. Spec errors: none.

## Graph writes proposed
