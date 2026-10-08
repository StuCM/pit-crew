// Changes one task file on a person's say-so: a frontmatter field, approval,
// or a body edit. The pit wall mod writes through here because `$.fs.write`
// is not atomic and knows nothing of the frontmatter fence.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { statuses } from '../lib/config.js';
import { readTask, readTasks, setField } from '../lib/task.js';
import { taskView } from '../lib/wall.js';
import { run as logEvent } from './log.js';
import { run as renderBoard } from './board.js';

const USAGE = `usage: crew task <id> set <status|model|env> <value>
       crew task <id> approve
       crew task <id> signoff    (from a pending-<env> status)
       crew task <id> sendback   (from blocked)
       crew task <id> edit    (JSON on stdin: {"old","new"} or {"section","append"})`;
const FENCE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const MODEL_ID = /^(opus|sonnet|haiku|claude-[a-z0-9.-]+)$/;

const refuse = (reason) => {
  console.error(`task: ${reason}`);
  return 1;
};

const count = (text, part) => text.split(part).length - 1;

const checkField = (cfg, key, value) => {
  if (!['status', 'model', 'env'].includes(key)) return `cannot set "${key}"`;
  // setField writes the value verbatim, so a newline would end the frontmatter early.
  if (!/^[\w.-]+$/.test(value ?? '')) return `"${value}" is not a single word`;
  if (key === 'status' && !statuses(cfg)[value])
    return `unknown status "${value}" — known: ${Object.keys(statuses(cfg)).join(', ')}`;
  if (key === 'model' && !Object.values(cfg.models).includes(value) && !MODEL_ID.test(value))
    return `"${value}" is not a configured model or a model id`;
  return null;
};

/** The body with one edit applied, or `{ error }`. */
export const editBody = (body, change) => {
  if (typeof change.old === 'string' && typeof change.new === 'string') {
    if (!change.old) return { error: 'nothing to replace' };
    const found = count(body, change.old);
    if (found === 0) return { error: 'that text is no longer in the spec' };
    if (found > 1) return { error: `that text appears ${found} times in the spec` };
    if (change.new) return { body: body.replace(change.old, () => change.new) };
    const line = body.includes(change.old + '\n') ? change.old + '\n' : change.old;
    return { body: body.replace(line, '') };
  }

  if (typeof change.section === 'string' && typeof change.append === 'string') {
    if (!change.append.trim()) return { error: 'nothing to append' };
    const lines = body.split('\n');
    const start = lines.findIndex((line) => line.trim() === `## ${change.section}`);
    if (start === -1) return { error: `no "## ${change.section}" section` };
    let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
    if (end === -1) end = lines.length;
    while (end > start + 1 && !lines[end - 1].trim()) end -= 1;

    // Continue the list in its own style: the next number, or a checkbox.
    const last = lines[end - 1];
    const number = /^(\d+)\. /.exec(last);
    const marker = number
      ? `${Number(number[1]) + 1}. `
      : /^- \[[ x]\] /.test(last)
        ? '- [ ] '
        : '- ';
    lines.splice(end, 0, marker + change.append);
    return { body: lines.join('\n') };
  }

  return { error: 'expected {"old","new"} or {"section","append"}' };
};

export const run = (cfg, [id, verb, ...rest] = [], input) => {
  if (!id || !verb) return refuse(USAGE);
  const task = readTasks(join(cfg.root, cfg.tasksDir)).find((t) => t.id === String(id));
  if (!task) return refuse(`no task ${id}`);

  if (verb === 'set') {
    const [key, value] = rest;
    const wrong = checkField(cfg, key, value);
    if (wrong) return refuse(wrong);
    setField(task.path, key, value);
  } else if (verb === 'approve') {
    if (task.meta.status !== 'draft') return refuse(`task is ${task.meta.status}, not draft`);
    setField(task.path, 'status', 'approved');
    logEvent(cfg, [task.path, 'spec']);
  } else if (verb === 'signoff') {
    const env = statuses(cfg)[task.meta.status]?.pendingEnv;
    if (!env) return refuse(`task is ${task.meta.status}, not waiting on an environment`);
    setField(task.path, 'status', 'done');
    logEvent(cfg, [task.path, `signoff ${env}`]);
  } else if (verb === 'sendback') {
    if (task.meta.status !== 'blocked') return refuse(`task is ${task.meta.status}, not blocked`);
    setField(task.path, 'status', 'approved');
    logEvent(cfg, [task.path, 'sendback']);
  } else if (verb === 'edit') {
    let change;
    try {
      change = JSON.parse(input ?? readFileSync(0, 'utf8'));
    } catch {
      return refuse('stdin is not JSON');
    }
    const [front] = FENCE.exec(task.text) ?? [''];
    const edited = editBody(task.text.slice(front.length), change ?? {});
    if (edited.error) return refuse(edited.error);
    writeFileSync(task.path, front + edited.body);
  } else {
    return refuse(USAGE);
  }

  renderBoard(cfg);
  // Last line, after the board's and the log's own: the mod reads it to redraw.
  console.log(JSON.stringify(taskView(cfg.root, readTask(task.path, task.file))));
  return 0;
};
