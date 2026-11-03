---
id: 015
slug: pit-wall-narrow-pane
status: done
branch: crew/015-pit-wall-narrow-pane
model: sonnet
env: laptop
rounds: 2
work: pit-wall-narrow-pane
files:
  - hooks/register.js
  - hooks/tests/panes.test.ts
  - src/lib/wall.js
  - src/commands/board.js
  - src/commands/review.js
  - src/commands/hook-scope.js
  - src/commands/plan.js
  - test/wall.test.js
  - test/board.test.js
  - templates/task.md
  - skills/crew-worker/SKILL.md
  - agents/crew-reviewer.md
  - README.md
gate: pass
gateSha: 5817c7e4e1801b0b8a11f530036c87d325896300
gateAt: 2026-10-23T22:17:21.727Z
---

# The pit wall reads well in a narrow pane and says why a task is blocked

## Goal
Opening the pit wall in a narrow pane shows tasks as readable two-line rows,
under clearly separated groups, and a blocked task shows the reason it blocked,
enough to reply in the chat without opening the task file. The task view loses
its Diagrams tab.

## Why now
Stu runs many chats with the pit wall in a thin side pane; today it is hard to
read there and "blocked" says nothing.

## Background
From Stu: the initial view with the tasks needs improving for readability and
use in a thinner panel; tasks are hard to read and the group splits aren't
clear. The individual task panel should also be styled to fit the thinner
panel. Goal, Approach and Context are good and should stay. Diagrams are not
used: remove them, hopefully improving efficiency. Blocked "just says blocked
but not why or what happened". Done means opening the pit wall gives enough
info to reply in the chat.

## Assumed
- Diagrams go from the mod only (the tab and everything that feeds it). `crew
  plan`, `part:`, the template's "The part this builds" and the worker's
  diagram step stay: they are text for the worker, not the pane.
- The blocked reason lives in a new `## Blocked` section of the task file,
  written by whoever sets `status: blocked`. No new CLI command.
- Work groups nest inside the existing role sections (Scout/Worker/Reviewer/
  Done), headed by the work JSON `title`, falling back to the slug. Tasks with
  no `work:` sit ungrouped at the top of their section.
- A blocked row in the board list shows the first line of its reason, dimmed,
  as its second line.

## Existing work
None.

## Graph context
- Desktop drops a whole ui_render answer silently at >=2000 nodes, depth
  >=32, or >=262,144 characters. Group headers and two-line rows add nodes:
  keep the tree shallow, no extra wrapper Boxes per row.
- Desktop draws a plain Button's hover itself; padding is by spaces (`pad`).
  A two-line Button label (`title\nmeta`) makes the whole row pressable.
- Desktop skips borders on pane top-level boxes: keep the `frame()` wrapper.
- Mod Text has no font size: hierarchy comes from Markdown `##`, bold and
  `dimColor`.
- The poll runs only while a pane is open (5a20334). Do not touch
  `loadBoard`/`check`.

## Constraints that bite here
- `hooks/tests/panes.test.ts` runs only under `claude plugin test .` from the
  plugin root, not `npm test`. Run both.

## Approach
1. **Board list rows** (`hooks/register.js:167` `boardList`). Replace the one
   flex-wrapping row with a column per task: line 1 is mark, id and title;
   line 2 is status and the `⚑` flag, dimmed; for a blocked task, line 2 also
   carries the first line of `task.blocked`. Prefer a single two-line Button
   label over extra Boxes. The pane opens at `columns: 72` (`openWall`, ~:660);
   nothing may need more than that to read.
2. **Group separation** (`buildSections`/`SECTIONS`/`markOf`, :129-165). Make
   role section headers stand out (Markdown `##` or bold plus a rule), and
   inside each section group tasks by `task.work`, with one dimmed header line
   per work group.
3. **Work titles.** `crew board --json` (`src/commands/board.js` ~:75) also
   emits `works` from `readWorks` (`src/lib/wall.js:140`), as slug to title.
   The mod uses the title when present, the slug otherwise.
4. **Remove Diagrams** (`hooks/register.js:303-478`): delete `changeMap`,
   `changeMapText`, `flowText`, `partText`, `FLOW_SYSTEM`, the
   `diagram`/`flow`/`flowState` state, `plans`, `loadPlan`, `generateFlow`,
   `PLAN_POINTER`, `diagramItems`; the `diagram` entry in `TABS` (:409); the
   `diagramItems` call (:625); the `count()` special case for 'diagram'
   (:629); `await loadPlan` in `loadDoc` (~:297). Delete `parseSpec`'s
   `newFiles` if nothing else reads it.
5. **Remove per-bullet editing** from the spec tab (`specBody`, ~:503-622).
   Each bullet renders as plain Markdown, full width, with no controls: delete
   the `ok-`, `edit-btn-` and `rm-` Buttons in `blockRow`, the edit `Input`
   branch, the section header's `add-` and `rm-section-` Buttons, and the
   `new-` Input. Then delete what only they used: `editing` (:251) and its
   resets, `marks` (:252), `block.state` (:274), `editSpec` (:118), and any
   `ICON` entries left unused. The "Approve spec" and sign-off buttons stay.
6. **Task view for a narrow pane.** The header row (~:780) with its Selects,
   controls and meta stacks vertically instead of wrapping in one row. Tabs
   are Spec / Context / Build record.
7. **Blocked reason, stored.** Add an empty `## Blocked` section to
   `templates/task.md` (after Definition of done) with a one-line comment: what
   stopped it and what is needed to unblock, in a few lines. Change the
   messages that tell an agent to set blocked so they name that section:
   `src/commands/review.js:26`, `src/commands/hook-scope.js:78`,
   `src/commands/plan.js:141`, `skills/crew-worker/SKILL.md` (:40, :44, :74,
   :158), `agents/crew-reviewer.md:73`.
8. **Blocked reason, read.** `taskView` (`src/lib/wall.js:88`) returns
   `blocked` from `sections(task.text)`'s Blocked section, trimmed, empty if
   absent. In the task view, `runControls` (:742) shows that text in place of
   the generic "review rounds disagreed", which remains only when the section
   is empty. Same text in `specHeader`.
9. **README** (:517-519, :530): drop the Diagrams tab and behaviour-flow
   description; one line on the Blocked section.
10. **Tests.** In `hooks/tests/panes.test.ts`: remove the diagram tests (458-505,
   the `planView` fixture ~96-112, `loadPlan` stubs) and the `tab-diagram`
   entries (251-277, 426-446); remove tests that press the per-bullet
   `ok-`/`edit-btn-`/`rm-`/`add-` controls; update board-list expectations (362-410) for
   the two-line rows; add a test that a work group header appears; extend the
   blocked test (519-528) to show a stored reason, and fall back when none
   exists; keep the "real-sized board stays within what Desktop draws" test
   passing. In `test/wall.test.js`, test that `taskView` returns `blocked`. In
   `test/board.test.js`, test that `--json` emits `works`.

## Out of scope
- Memory use (task 016).
- `crew plan`, `part:`, the template's "The part this builds", the worker's
  diagram step, and the planning plugin's maps.
- Polling, `loadBoard`, `check`, and how the pane opens.
- A new CLI command for blocking.
- `crew task <id> edit` itself (the CLI stays; only the pane stops calling it).
- Changing which statuses or roles exist.

## Definition of done
- [ ] In the pit wall board list, each task renders as at most two lines: id
      and title, then status (and flag), and no line in the list needs more
      than 72 columns of fixed content beyond the title.
- [ ] Tasks sharing a `work:` appear together under one header showing the
      work JSON's `title` (or the slug when there is no JSON).
- [ ] Spec-tab bullets and section headers have no tick, edit, remove or add
      controls; `hooks/register.js` no longer defines `editing`, `marks` or
      `editSpec`.
- [ ] The task view has exactly the tabs Spec, Context and Build record; no
      code in `hooks/register.js` references `loadPlan`, `diagramItems` or
      `FLOW_SYSTEM`.
- [ ] A blocked task whose file has a non-empty `## Blocked` section shows that
      text in the task view and its first line in the board list; one with an
      empty section still shows "review rounds disagreed".
- [ ] `templates/task.md` has a `## Blocked` section, and every message listed
      in Approach step 7 names it.
- [ ] `npm test` and `claude plugin test .` both pass, including the
      Desktop-size test.
- [ ] tests cover the behaviour, and fail if it regresses
- [ ] the gate passes (`npx crew gate <this file>`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Scout requests

## Review rounds
Round 1: CHANGES. Blocked row carried the generic flag plus the reason; the reason showed twice in the task view. Fixed: row shows only the reason, header omits the stored reason.
Round 2: PASS.

Notes: project.md says multi-line Button labels show only line 1, so rows are a Button (id, title) plus a Text line below, not one two-line label. The spec's "real-sized board stays within what Desktop draws" test does not exist in panes.test.ts, so none was kept. Work groups nest inside each role section; section headers carry a rule.

## Graph writes proposed
