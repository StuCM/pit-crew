---
id: 014
slug: crew-without-npx
status: review
branch: crew/014-crew-without-npx
model: sonnet
env: laptop
rounds: 1
files:
  - hooks/hooks.json
  - hooks/register.js
  - hooks/tests/panes.test.ts
gate: pass
gateSha: 69ecfba84fe5119ebd49f00289b21b6b68073835
gateAt: 2026-10-23T10:38:21.260Z
---

# The pit wall and the scope hook stop starting npm on every call

## Goal
The pit wall mod and the PreToolUse scope hook run crew's CLI with `node`
directly, never through `npx`. The mod only polls the board while its pane is
open, so a chat without the pane open runs no crew processes in the background.

## Why now
Measured 2026-10-23 on the person's laptop, with 6 chats open:
- Each chat with the crew plugin runs `npx --no-install crew board --json`
  every 10 s. That's `hooks/register.js:1089`, `$.clock.every(10000, …)` on
  `session.start`, whether or not the pane is open.
- Across the open chats that came to roughly one npm + node start every 3 s.
- Every Edit/Write also runs `npx --no-install crew hook scope`
  (`hooks/hooks.json`), about 0.3 s of npm start-up before the check itself.
- The person is trying to cut background CPU and memory, with Claude as a
  major consumer.

## Background
- **The SessionStart precedent.** `hooks/hooks.json` already runs
  SessionStart as `node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" hook session`.
  The scope hook should match it.
- **Why `npx` was used** (`8552e3e`, when crew moved into its own repo): no
  recorded reason. `node` on the plugin's own `src/cli.js` runs the same code
  the plugin ships.
- **Every `npx` call in the mod:**
  - `register.js:40` `loadBoard`;
  - `register.js:65` the `crew` helper used for every write;
  - `register.js:474` `crew plan … --json`.

## Assumed
- **The CLI path in the mod.** The mod resolves `src/cli.js` from its own
  location (`new URL('../src/cli.js', import.meta.url)`) and runs
  `['node', cliPath, …]`.
  - If the mod runtime gives no `import.meta.url`, use whatever plugin-root
    value the `$` engine exposes; ask via a scout request rather than guess.
  - If neither works, keep `npx` and say so. Do not invent a path.
- **Polling.** It starts when the pane renders (`ui.render` for `Pane`,
  `register.js:1113`) and stops when the pane is closed or hidden, if the
  engine reports that. Otherwise it polls only while the last render is
  under 30 s old.
  - The interval stays at 10 s.
  - Writes through the `crew` helper still refresh at once.
- **The `AbovePrompt` render** (`register.js:1098`) must not start polling
  on its own. If it shows board data, it uses the last loaded board.

## Existing work
None.

## Graph context
- Pattern "Claude memory footprint per open chat" (2026-10-23): per-chat
  background processes are the main cost the person is cutting.

## Constraints that bite here
- `hooks/tests/panes.test.ts` fakes `process.run` (line 150). Assertions on
  argv must change from `npx` to `node <cli>`.
- The mod test runs outside `node --test` (commit `5846250`). Run it the way
  `npm run verify` / `claude plugin test` does.

## Approach
1. `hooks/hooks.json`: change the PreToolUse command to
   `node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" hook scope`, keeping the timeout.
2. `hooks/register.js`:
   - one `CREW` argv prefix built once, used by `loadBoard`, `crew` and the
     `plan` call;
   - move the `$.clock.every` out of `session.start` into a start-on-pane-render
     / stop-on-close pair as in Assumed;
   - `session.start` keeps only the command registration.
3. `hooks/tests/panes.test.ts`:
   - argv starts with `node` and ends at `src/cli.js`;
   - no `process.run` happens after `session.start` until the pane renders;
   - after the pane closes, the clock fires no further board loads.

## Out of scope
- Making `crew board --json` itself faster.
- The Taiga MCP and memory-graph changes (separate work, not in this repo).
- Any change to `src/`.

## Definition of done
- [ ] `hooks/hooks.json` runs the scope hook with `node` on the plugin's
      `src/cli.js`; no `npx` remains in `hooks/`
- [ ] the mod runs every crew command as `node <plugin>/src/cli.js …`
- [ ] with the pane never opened, a session runs no `crew` process after
      `session.start` (test)
- [ ] with the pane open, the board refreshes every 10 s; after it closes,
      it stops (test)
- [ ] the gate passes (`npx crew gate .claude/tasks/014-crew-without-npx.md`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Scout requests

## Review rounds

## Graph writes proposed
