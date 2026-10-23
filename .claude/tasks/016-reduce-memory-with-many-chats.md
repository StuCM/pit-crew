---
id: 016
slug: reduce-memory-with-many-chats
status: done
branch: crew/016-reduce-memory-with-many-chats
model: sonnet
env: laptop
rounds: 2
files:
  - bin/crew
  - src/commands/hook-session.js
  - test/hook-session.test.js
  - src/lib/wall.js
  - test/wall.test.js
  - skills/crew-orchestrate/SKILL.md
  - skills/crew-setup/SKILL.md
  - skills/crew-close/SKILL.md
  - skills/crew-worker/SKILL.md
  - skills/crew-spec/SKILL.md
  - skills/crew-run/SKILL.md
  - skills/crew-status/SKILL.md
  - agents/crew-reviewer.md
  - agents/crew-fixer.md
  - agents/crew-scout.md
  - templates/task.md
  - planning/skills/agent-tasks/SKILL.md
  - planning/skills/agent-tasks/scripts/exporters/crew.py
  - package.json
  - README.md
gate: pass
gateSha: 69fe59568aea08edc44787e33709b9e51f8d01de
gateAt: 2026-10-23T23:25:46.596Z
---

# Agents run crew directly instead of through npx

## Goal
Inside a Claude Code session where the crew plugin is loaded, every crew
command an agent runs is `crew …`, started as one node process, instead of
`npx crew …`, which also holds an `npm exec` wrapper for the whole command.

## Why now
Stu runs many chats at once and memory is high. Measured 2026-10-24: each
`npx crew` holds an `npm exec` wrapper (~86 MB) on top of crew's own node
process (~48 MB) for as long as the command runs. A gate run lasts minutes,
and several workers gate at once.

## Background
Stu: "I think the pit crew is also causing high memory usage... I have lots
of chats running at once." Already dealt with elsewhere, not this task: the
memory graph now runs as one shared server; the Taiga MCP server (~190 MB per
chat) was removed from user config. Task 014 already made the hooks and the
pit wall mod run `node ${CLAUDE_PLUGIN_ROOT}/src/cli.js` instead of npx.

## Assumed
- Claude Code applies `export` lines that a SessionStart hook appends to the
  file named by `$CLAUDE_ENV_FILE` to every later Bash command in that
  session, subagents included. This is documented hook behaviour, but not yet
  checked live with crew.
- `bin/crew` is a symlink to `../src/cli.js` (already executable, with a
  `#!/usr/bin/env node` shebang), and the hook puts
  `${CLAUDE_PLUGIN_ROOT}/bin` first on PATH, so `crew` is always the plugin's
  own copy.
- Text that people read outside a plugin session (CLI error messages in
  `src/commands/*.js`, `src/lib/config.js`, the README's npm install section)
  keeps `npx crew`, because that's what works for an npm-only install.

## Existing work
None.

## Graph context
- A worker's Bash runs from a shell that starts outside its worktree (crew-run
  brief), so `crew` must resolve by PATH, not by a relative path.
- The commit hook rejects `Co-Authored-By:` lines in this repo.

## Constraints that bite here
- `hook session` must never fail a session start: if `CLAUDE_ENV_FILE` is
  unset or not writable, skip the PATH line silently.

## Approach
1. Add `bin/crew` as a symlink to `../src/cli.js`; add `bin` to `files` in
   `package.json`.
2. In `src/commands/hook-session.js`, when `process.env.CLAUDE_ENV_FILE` is
   set, append `export PATH="<plugin root>/bin:$PATH"` once. The plugin root
   is the directory above `src/`, resolved from `import.meta.url`. Skip it if
   that exact line is already in the file. This runs whether or not the repo
   uses crew; it costs nothing.
3. Replace `npx crew` with `crew` in every skill and agent file listed in
   `files:`, in `templates/task.md`, and in the planning `agent-tasks` skill
   and its crew exporter (the text it writes into specs).
4. `src/lib/wall.js:209`: the allow-list gains `'Bash(crew gate:*)'`; keep the
   `npx` entry for older specs.
5. README: one line in the plugin section saying agents call `crew` directly
   and why; the npm section stays as it is.
6. Tests: in `test/hook-session.test.js`, with `CLAUDE_ENV_FILE` pointing at a
   temp file, the hook appends the PATH line exactly once across two runs,
   and with it unset, it writes nothing and still exits 0. In
   `test/wall.test.js`, the allow-list includes `Bash(crew gate:*)`.

## Out of scope
- The memory-graph server and the Taiga config (already done outside crew).
- CLI messages printed by `src/commands/*.js` and `src/lib/config.js`.
- The pit wall mod and its polling.
- Renaming or changing any crew command.

## Definition of done
- [ ] `grep -rn "npx crew" skills agents templates planning` prints nothing.
- [ ] `bin/crew --version` (or `bin/crew help`) runs from any directory.
- [ ] With `CLAUDE_ENV_FILE` set, `node src/cli.js hook session` appends the
      PATH line once, and twice in a row still leaves one line.
- [ ] With `CLAUDE_ENV_FILE` unset, the hook exits 0 and writes no file.
- [ ] The wall allow-list includes `Bash(crew gate:*)`.
- [ ] `npm test` and `claude plugin test .` both pass.
- [ ] tests cover the behaviour, and fail if it regresses
- [ ] the gate passes (`npx crew gate <this file>`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Blocked

## Scout requests

## Review rounds

Round 1: CHANGES (unset-env test did not test unset; fixed, folded into the commit). Round 2: PASS.

Changed: bin/crew (symlink), package.json (bin in files), hook-session.js (exportPath, before the worker early return), wall.js (allow-list), skills/agents/templates/planning (npx crew -> crew), README line, two tests.

Spec note: cli.js returns before hook-session.js outside a crew repo and src/cli.js is not in files:, so the PATH line is written only in repos with crew config (all crew workers and orchestrators).

## Graph writes proposed
