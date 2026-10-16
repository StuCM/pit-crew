---
id: 013
slug: dispatch-as-desktop-card
status: done
branch: crew/013-dispatch-as-desktop-card
model: sonnet
env: laptop
rounds: 1
files:
  - src/lib/handover.js
  - src/lib/worktrees.js
  - test/board.test.js
  - src/commands/dispatch.js
  - src/commands/preflight.js
  - src/cli.js
  - src/commands/hook-session.js
  - test/handover.test.js
  - test/hook-session.test.js
  - skills/crew-run/SKILL.md
  - skills/crew-worker/SKILL.md
  - skills/crew-close/SKILL.md
gate: pass
gateSha: 4850ec0b90dfd6259a576d942699ec9b74da6870
gateAt: 2026-10-16T09:17:56.952Z
---

# Running a task leaves a desktop card that opens the task as its own chat

## Goal
`crew dispatch <id>` cuts the task's worktree with everything the gate needs.
crew-run then queues a card in the desktop app; one click opens the task as its
own chat titled for the task, which moves into its worktree and works the task.
No terminal command to paste.

## Why now
On 2026-10-16 tasks 011 and 012 were run as background agents and every hand-off
cost a round trip:
- the gate refused in both worktrees ("no .claude/crew.config.json");
- both workers stopped before the reviewer's verdict, which was delivered to the
  orchestrator instead;
- earlier agents kept handing the person a `claude ...` line to paste.

## Background
From the person: "yes cards, I think it makes it much easier for me to intercept
if needed". Tasks should be chats they can open, and those chats close once the
task is done and merged (task 012, merged 1e0e97f).

Prior work to port, not rewrite: cloud branch `origin/ccr-80437362-jqsb6o`
(2026-10-11, forked from 3cc7fd4, long before the pit wall).
- `src/lib/handover.js`: `findTask`, `projectName`, `worktreePath`,
  `branchFor`, `modelFor`, `briefFor`, `cardFor`.
- `src/commands/dispatch.js`: `dispatch(cfg, task, {force})` and `run`.
- `test/handover.test.js`.
- Its commit 29ac33a records a probe: a desktop card opens a local session **in
  the main checkout**, with crew and EnterWorktree available. A card can set
  neither a folder nor a model, so the card's prompt enters the worktree first
  and names the spec's model.

Read these with `git show origin/ccr-80437362-jqsb6o:<path>`. Do not merge or
cherry-pick the branch; it conflicts with everything since.

## Assumed
- **`building` goes on the worktree's copy only.** Dispatch sets
  `status: building` in the worktree's copy of the task file, not the main
  checkout's. Since 011 (63b4657) the board reads a dirty worktree copy, so it
  still shows `building`. Leaving the main copy untouched means the merge brings
  the worker's final status in without a conflict on `status:`. This replaces
  the cloud branch's `setField(task.path, ...)` on main.
- **Dispatch copies what the gate needs.** It copies the untracked
  `.claude/crew.config.json`, `.claude/crew/project.md` and the task file (if
  not committed) into the worktree, whenever they are missing there.
- **Collisions reuse main's existing check.** The checks for in-flight overlaps
  and git collisions reuse what `crew collisions` already runs on main
  (`collisions` in `src/commands/preflight.js:74`). Export a function from there
  if needed (add preflight.js via a scout request), instead of porting the
  branch's `inFlightOverlaps` and `findCollisions`.
- **crew-close finds the task chat by its title.** `spawn_task` returns a chip
  id, not a session id. crew-close finds the task's chat with `list_sessions`
  by title `Task <id>: …`, or by `session:` if the worker recorded one, and
  archives it after the merge. If neither finds it, it tells the person which
  chat to close.
- **The card's chat switches its own model.** The card cannot set a model,
  so its prompt tells the chat to switch itself with the desktop
  `set_session_model` tool, falling back to asking the person to `/model`.
  Unverified: whether that tool can target the calling session; if it can't,
  the fallback line is what runs.
- **Pit wall Run button out of scope.** The cloud branch's `queueCard` in the
  pit-wall mod does not come over; the desktop env is unreachable for agents.

## Existing work
None. (The cloud branch origin/ccr-80437362-jqsb6o is the source being ported, not a collision: it forks from 3cc7fd4 and none of its commits touch these paths on main.)

## Graph context
- Pattern "fresh crew worktree has no crew config": the gate refuses in a
  new worktree because `.claude/` is gitignored and only task files are
  force-tracked.
- Pattern "background workers stop before review verdict": a reviewer spawned in
  the background delivers its verdict to the parent session, not the worker.
- Pattern "task-chip sessions are user-placed, not linked": a card's chat has
  no `startedBy`, so do not rely on parent links.
- Decision "One explicitly claimed orchestrator per repo" (012): the
  SessionStart hook tells each chat orchestrator / side chat / none. A card's
  chat starts in the main checkout on the base branch, so it gets one of those
  texts. It must also be told that a worker prompt wins.

## Constraints that bite here
- Every git call goes through `git()` / `gitTry` (if absent on main, use
  `git()` from `src/lib/git.js`) as an argv array.
- The hook must never fail a session. `src/commands/hook-session.js` keeps
  the early return for a `crew/` branch.

## Approach
1. Port `src/lib/handover.js` from the cloud branch as is. Keep `cardFor`'s
   prompt shape: enter the worktree via EnterWorktree with the absolute path,
   then the model step, then the brief. Change the model step from the cloud
   branch's "say so so the person can /model" to: "The spec chose `<model>`.
   If you are running on another, switch this session to it now (load
   `mcp__ccd_session_mgmt__set_session_model` and call it for this session);
   only if that tool is unavailable, tell the person in one line to `/model`." The title is `Task <id>: <title>`,
   kept to 58 characters.
2. Port `src/commands/dispatch.js`, adapted:
   - collisions as in Assumed;
   - after the worktree exists, copy the three files from Assumed if missing;
   - set `status: building` with `setField` on the **worktree's** task file;
   - `crew board` and `appendLog`/`logEvent` (whichever main has) `dispatch`.
   `--json` prints the result object, including `card`, `brief`, `command`,
   `worktree` and `model`. Without `--json` it prints the worktree, model and
   brief in a few lines. Register `dispatch` in `src/cli.js` `COMMANDS` with a
   USAGE line.
3. `src/commands/hook-session.js`: add to all three role texts (orchestrator,
   side chat, none) the cloud branch's sentence: "If your prompt hands you a
   crew task for the crew-worker skill, you are its worker, not the
   orchestrator: enter its worktree as the prompt says and follow crew-worker
   instead."
4. `skills/crew-run/SKILL.md`:
   - §2 worktree and §3 hand-over become `npx crew dispatch <id> --json`;
   - if `mcp__ccd_session__spawn_task` is available, pass `card` (title, tldr,
     prompt, verbatim) to it, and tell the person in one line that the card is
     in the app;
   - otherwise give the paste line;
   - a background Agent is used only when the person asks for it ("just run
     it"), and then the brief must say to run the reviewer in the foreground.
5. `skills/crew-worker/SKILL.md:151`: spawn `crew-reviewer` in the
   **foreground** and wait for its verdict before doing anything else; never
   hand back with a round open.
6. `skills/crew-close/SKILL.md`: the archive step as in Assumed.
6a. `src/lib/worktrees.js` `readLiveTasks` (from 011): a dirty task file in the
   task's live worktree wins **before** the merged check. A just-dispatched
   branch has no commits, so `isMerged` is true and the worktree copy saying
   `building` was ignored. Only the `git show <branch>:` path stays gated on
   unmerged. Add a case to `test/board.test.js`: branch at base tip, worktree
   copy edited to `building`, board shows `building`.
7. `test/handover.test.js`, ported and extended, using `sandbox()`:
   - dispatch cuts the worktree from base on the task's branch;
   - the worktree has crew.config.json and project.md;
   - the worktree's task file says `building` and the main copy still says
     `approved`;
   - the card title, the prompt's EnterWorktree path, and the prompt ending in
     the brief;
   - a non-approved task is refused with nothing on disk changed.
   `test/hook-session.test.js`: the worker sentence appears in each role text.

## Out of scope
- The pit-wall mod's Run button and `queueCard`.
- `crew tasks` and the board pane from the cloud branch.
- Deleting the cloud branch.

## Definition of done
- [ ] `crew dispatch 7 --json` on an approved task 007 in a temp repo exits 0,
      creates `<worktreeDir>/<project>-007` on its branch, and prints JSON with
      `card.title` matching `^Task 007: ` and `card.prompt` containing the
      worktree's absolute path, `set_session_model` and the spec's model, and
      ending with `brief`
- [ ] that worktree contains `.claude/crew.config.json` and
      `.claude/crew/project.md`, and its task file says `status: building`,
      while the main checkout's says `status: approved`
- [ ] `crew dispatch` on a draft task exits non-zero, and no worktree or branch
      is created
- [ ] with a branch at the base tip and its worktree's task file edited to
      `building`, `crew board --json` reports `building`
- [ ] the SessionStart hook text contains the worker sentence for the
      orchestrator, side-chat and no-orchestrator cases
- [ ] crew-run, crew-worker and crew-close carry the lines in Approach 4–6
- [ ] tests cover the above, and fail if the copy step or the worktree-only
      status write is removed
- [ ] the gate passes (`npx crew gate .claude/tasks/013-dispatch-as-desktop-card.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Scout requests
- Q: is there a function returning (not printing) collisions or in-flight overlaps for dispatch to call?
  A: no; `collisions` in preflight.js:74 is private and prints, only `run` calls it, no tests cover it.
  Changed the build: yes — exported `findCollisions(cfg, task)` from preflight.js (added to `files:`, as Assumed pre-authorised).

## Review rounds
- Round 1 (gate 4850ec0): PASS — all DoD items met; no findings.

## What changed
- `src/lib/handover.js`: ported; card's model step now switches the session via `set_session_model`, `/model` as fallback.
- `src/commands/dispatch.js`: ported; collisions via preflight's `findCollisions`, copies config/brief/uncommitted spec, `building` on the worktree copy only, board+log routed to stderr.
- `src/commands/preflight.js`: `findCollisions(cfg, task)` extracted and exported; `crew collisions` output unchanged.
- `src/cli.js`: `dispatch` registered with a USAGE line.
- `src/commands/hook-session.js`: worker sentence appended to every role text.
- `src/lib/worktrees.js`: dirty worktree copy wins before the merged check.
- skills crew-run / crew-worker / crew-close: dispatch + card, foreground reviewer, archive by title.
- tests: handover.test.js (new), board and hook-session cases.

## Where the spec was off
- Main has no `gitTry` and no in-flight overlap helper; dispatch uses `git()` (null on failure) and only git collisions. Board-level in-flight overlap stays a manual step in crew-run §1.
- Unverified (as spec said): `set_session_model` refuses to target the calling session — confirmed live in this very session ("Refused for this session"), so the `/model` fallback line is what runs.

## Graph writes proposed
- Pattern "set_session_model cannot switch its own session": the desktop tool refuses the calling session; a card-started chat must ask the person to pick the model. Consider dropping the tool step from `cardFor` or having the orchestrator switch the new chat after it appears.
- Pattern "worktree-isolated session refuses compound git shells": a session entered via EnterWorktree refuses Bash commands that mix `git` with heredocs/pipes; split into plain commands or use Edit.
