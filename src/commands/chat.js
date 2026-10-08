// `crew chat <id>` — the pit wall's task chat: one resumable crew-spec-editor
// session per task, kept in wall.json and out of the main session.

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { git } from '../lib/git.js';
import { readTasks } from '../lib/task.js';
import { agentArgs, readState, writeState } from '../lib/wall.js';
import { runAgent } from '../lib/agent.js';

const EDITOR = fileURLToPath(new URL('../../agents/crew-spec-editor.md', import.meta.url));

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

/** Every ```replace block in a reply, as `{ old, new }`. */
export const suggestions = (reply = '') => {
  const found = [];
  for (const [, block] of reply.matchAll(/```replace\n([\s\S]*?)```/g)) {
    const old = /^old: ?(.*)$/m.exec(block)?.[1];
    const replacement = /^new: ?(.*)$/m.exec(block)?.[1];
    if (old && replacement !== undefined) found.push({ old, new: replacement });
  }
  return found;
};

// Whether `--allowedTools Edit(<path>)` holds the agent to one file in `claude -p`
// is unverified, so the files it could change are compared before and after.
// Changed-but-unstaged files plus the task files, which git ignores here.
const snapshot = (cfg) => {
  const changed = (git(['ls-files', '-z', '-m', '-o', '-d', '--exclude-standard'], cfg.root) ?? '')
    .split('\0')
    .filter(Boolean);
  const tasks = readdirSync(join(cfg.root, cfg.tasksDir)).map((name) => join(cfg.tasksDir, name));
  return new Map([...changed, ...tasks].map((path) => [path, read(join(cfg.root, path))]));
};

// Other task files are only reported: crew sessions write them while the agent runs.
/** Files other than `keep` that changed since `before`: the rest put back, task files only named. */
const guard = (cfg, before, keep) => {
  const reverted = [];
  const otherSpecs = [];
  for (const [path, now] of snapshot(cfg)) {
    const was = before.get(path);
    if (path === keep || was === now) continue;
    if (path.startsWith(cfg.tasksDir + '/')) {
      otherSpecs.push(path);
      continue;
    }
    reverted.push(path);
    const full = join(cfg.root, path);
    if (typeof was === 'string') writeFileSync(full, was);
    else if (was === null) rmSync(full, { force: true });
    else if (git(['checkout', '--', path], cfg.root) === null) rmSync(full, { force: true });
  }
  return { reverted, otherSpecs };
};

export const run = async (cfg, [id, ...flags] = [], input) => {
  const task = readTasks(join(cfg.root, cfg.tasksDir)).find((t) => t.id === String(id));
  if (!task) {
    console.error(id ? `chat: no task ${id}` : 'usage: crew chat <id> [--history]');
    return 1;
  }
  const state = readState(cfg.root);
  const chat = state.chat?.[task.id] ?? { session: null, turns: [] };
  if (flags.includes('--history')) {
    console.log(JSON.stringify(chat.turns));
    return 0;
  }

  const message = (input ?? readFileSync(0, 'utf8')).trim();
  if (!message) {
    console.error('chat: nothing to send (the message goes on stdin)');
    return 1;
  }
  // An API key in the environment outranks a subscription login for `claude -p`.
  if (process.env.ANTHROPIC_API_KEY)
    console.error(
      'note: ANTHROPIC_API_KEY is set, so this chat bills the API, not your subscription.',
    );

  const spec = relative(cfg.root, task.path);
  const tools = ['Read', 'Grep', 'Glob', `Edit(${spec})`];
  const specBefore = read(task.path);
  const before = snapshot(cfg);
  const answer = await runAgent(
    cfg.root,
    agentArgs(EDITOR, 'crew-spec-editor', tools, chat.session),
    `Spec file: ${spec}\n\n${message}`,
  );
  const { reverted, otherSpecs } = guard(cfg, before, spec);
  const at = new Date().toISOString();

  // Read again: the agent ran for minutes, and the mod or another chat may have written meanwhile.
  const latest = readState(cfg.root);
  latest.chat ??= {};
  latest.chat[task.id] ??= { session: null, turns: [] };
  const entry = latest.chat[task.id];
  entry.turns.push({ who: 'you', text: message, at });
  entry.turns.push({
    who: 'planner',
    text: answer.text ?? answer.error,
    error: Boolean(answer.error),
    at,
  });
  if (answer.session) entry.session = answer.session;
  writeState(cfg.root, latest);

  const result = {
    text: answer.text ?? answer.error,
    suggestions: suggestions(answer.text),
    edited: read(task.path) !== specBefore,
    reverted,
    otherSpecs,
  };
  if (answer.error) result.error = true;
  if (reverted.length)
    console.error(`chat: reverted the agent's changes to ${reverted.join(', ')}`);
  if (otherSpecs.length)
    console.error(`chat: other task files changed meanwhile: ${otherSpecs.join(', ')}`);
  console.log(JSON.stringify(result));
  return answer.error ? 1 : 0;
};
