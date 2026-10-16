---
id: 011
slug: board-reads-live-task-branch
status: done
branch: crew/011-board-reads-live-task-branch
model: sonnet
env: laptop
rounds: 2
files:
  - src/lib/worktrees.js
  - src/lib/wall.js
  - src/commands/board.js
  - test/board.test.js
  - test/wall.test.js
gate: pass
gateSha: 383daa24298505d32fc54f8a4f3f67389c4db3b2
gateAt: 2026-10-16T08:08:37.132Z
---

# The board and pit wall show a task's in-flight status, not its dispatch-time one

## Goal
`crew board`, `crew board --json` and the pit wall show the status, rounds and
notes a worker has committed on its task branch (or left uncommitted in its
worktree), without the branch having been merged first.

## Why now
Seen in arches-toolkit on 2026-10-13: tasks 001–004 had workers report done
while the wall still said `building`.

## Background
From the person: every reader resolves task files as
`join(cfg.root, cfg.tasksDir)` with `cfg.root` = `git rev-parse --show-toplevel`
of the cwd (`src/lib/git.js:42` `repoRoot`, `src/lib/config.js`,
`src/lib/wall.js:158` `snapshot`, `src/commands/board.js:84-85` `run`,
`src/lib/worktrees.js:62` `listWorktrees`). Workers run in
`<worktreeDir>/<project>-<id>` on the task's `branch:`, write status/rounds/notes
into the task file there, commit it on the task branch, then
`git switch --detach` (crew-worker step at `skills/crew-worker/SKILL.md:201`).
So the main checkout keeps the dispatch-time copy until merge.

Preferred fix, as given: for each task whose `branch:` exists and is not merged
into baseBranch, read the file from the branch (`git show <branch>:<tasksDir>/<file>`),
or from its worktree if that copy is dirty; main checkout copy as fallback.

## Assumed
- The override lives in one helper used by all three readers named above; the
  write commands (`crew task <id> set|approve|signoff|sendback|edit`,
  `src/commands/task.js:77`) keep reading and writing the main-checkout copy.
- `task.path` stays the main-checkout path (so `taskView`'s
  `relative(root, task.path)` and every writer are unchanged); only `text`,
  `meta` and `title` come from the live copy.
- "Dirty" means `git status --porcelain -- <tasksDir>/<file>` in that worktree is
  non-empty; the worktree is found the way `taskFor` already finds it.

## Existing work
None.

## Graph context
None queried — scout skipped; the person named the files and the fix.

## Constraints that bite here
- Readers must not throw on a missing/odd branch, a pruned worktree, or a task
  file absent on the branch: fall back to the main copy silently.
- No new dependency; git calls go through `git()` / `gitLines()` in
  `src/lib/git.js`, which already return null/empty on failure.

## Approach
1. In `src/lib/worktrees.js`, export `readLiveTasks(cfg)`: `readTasks(join(cfg.root, cfg.tasksDir))`,
   then for each task with `meta.branch` in `branches(cfg.root)` and
   `!isMerged(cfg, baseRef(cfg), meta.branch)`:
   - find its worktree from `worktrees(cfg.root)` with the existing `taskFor`
     logic (reuse it; invert the lookup, don't write a second matcher). If the
     worktree exists (`!isGone`) and its copy of the task file is dirty, read
     that file;
   - otherwise `git(['show', `${branch}:${cfg.tasksDir}/${task.file}`], cfg.root)`;
   - if either yields text, rebuild `meta`/`title`/`text` from it with
     `frontmatter` (export a small `parseTask(text, path, file)` from
     `src/lib/task.js` if that's the cleanest way to share `readTask`'s body —
     add `src/lib/task.js` to `files:` via a scout request if so). Keep `path`
     and `file`.
   Compute `baseRef` and `branches` once, not per task.
2. `listWorktrees` uses `readLiveTasks(cfg)` in place of its `readTasks` call.
3. `src/lib/wall.js` `snapshot` uses `readLiveTasks(cfg)`. Check for an import
   cycle between wall.js and worktrees.js; if there is one, move
   `readLiveTasks` to wall.js's side rather than restructuring modules.
4. `src/commands/board.js` `run` uses `readLiveTasks(cfg)`; the `--json` path
   already goes through `snapshot`.
5. Test in `test/board.test.js` (reuse the temp-repo helpers in `test/helpers.js`):
   base commit has the task file `status: building` with `branch: crew/001-x`;
   create that branch, commit `status: done` on it, return to base. Assert
   `crew board` output / BOARD.md and `--json` show `done`. Second case:
   merge the branch → still `done`, from main. Third: an uncommitted edit in a
   worktree on the branch (`status: blocked`) wins over the branch commit.
   Fourth: the branch is deleted → main copy (`building`).
6. The crew-close note (do not hand-edit the main checkout's task file before
   merging) moved to task 012, which already edits that skill.

## Out of scope
- Making the write commands (`set`, `signoff`, `sendback`, `edit`, `approve`)
  write to the branch or worktree copy. Known gap: `sendback` on a blocked,
  unmerged task edits the main copy while the branch has its own — the next
  merge may conflict on the `status:` line. Separate task if wanted.
- `doctor`, `preflight`, `fix` readers.
- crew-run / crew-worker skill text (no change needed: the worker already
  commits the task file on its branch).
- Any change to how workers commit or detach.

## Definition of done
- [ ] With the task file saying `building` on base and `done` committed on its
      unmerged branch, `crew board` writes `done` to BOARD.md and
      `crew board --json` reports `"status":"done"` for it
- [ ] An uncommitted change to the task file in the task's worktree is what the
      board shows, over the branch commit
- [ ] Merged or missing branch → the main-checkout copy is shown
- [ ] `crew task <id> ...` still edits the main-checkout file (`task.path` unchanged)
- [ ] tests cover the four cases above, and fail if `readLiveTasks` is replaced
      by `readTasks`
- [ ] the gate passes (`npx crew gate .claude/tasks/011-board-reads-live-task-branch.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Scout requests

## Review rounds
Round 1: CHANGES. readLiveTasks read a dirty worktree copy unguarded, so a task file deleted in the worktree threw ENOENT. Fixed with a guarded read falling back to the branch copy, plus a test. Residual, left alone: taskFor also matches a worktree by path regardless of branch.

Round 2: PASS.

## Done
- src/lib/worktrees.js: readLiveTasks (branch or dirty-worktree copy over main copy, guarded read, silent fallback); listWorktrees uses it.
- src/lib/wall.js: snapshot uses readLiveTasks.
- src/commands/board.js: run uses readLiveTasks.
- test/board.test.js: five tests (unmerged, merged, dirty worktree, deleted branch, deleted worktree file).
- Spec gap: parseTask not added (task.js not in files:); title regex duplicated in worktrees.js.

## Graph writes proposed
- Pattern: .claude/crew.config.json and .claude/crew/project.md are untracked in the main checkout, so a fresh worktree lacks them and `crew gate` fails; copy the config and symlink node_modules.
