// Changes one task file on a person's say-so: a frontmatter field, approval,
// or a body edit. The pit wall mod writes through here because `$.fs.write`
// is not atomic and knows nothing of the frontmatter fence.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { statuses } from '../lib/config.js';
import { clearField, readTask, readTasks, setField } from '../lib/task.js';
import { taskView } from '../lib/wall.js';
import { run as logEvent } from './log.js';
import { run as renderBoard } from './board.js';
import { mainRoot, openRaised, saveWork } from './work.js';
import { readWorks } from '../lib/wall.js';

// Who can stop a task. The pit wall and the board show this beside the
// reason, so "blocked" on its own never reaches the person again.
export const BLOCKERS = ['worker', 'reviewer', 'rounds', 'scope', 'challenger', 'person'];

const USAGE = `usage: crew task <id> set <status|model|env> <value>
       crew task <id> approve
       crew task <id> signoff    (from a pending-<env> status)
       crew task <id> sendback   (from blocked)
       crew task <id> block <who> <reason…>   (who: ${BLOCKERS.join('|')})
       crew task <id> question [--affects 025,026] [--evidence <text>] <question…>
                            (a reviewer's doubt about the group's approach)
       crew task <id> edit    (JSON on stdin: {"old","new"} or {"section","append"})`;
const FENCE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const MODEL_ID = /^(opus|sonnet|haiku|claude-[a-z0-9.-]+)$/;

// `--affects a,b --evidence text words…`: the flags, then the question.
const questionArgs = (rest) => {
  const out = { affects: [], evidence: null, words: [] };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--affects') out.affects = (rest[++i] ?? '').split(',').filter(Boolean);
    else if (rest[i] === '--evidence') out.evidence = rest[++i] ?? null;
    else out.words.push(rest[i]);
  }
  return out;
};

const oneLine = (words) => words.join(' ').replace(/\s+/g, ' ').trim();

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
    const work = task.meta.work && readWorks(mainRoot(cfg)).find((w) => w.slug === task.meta.work);
    const open = work ? openRaised(work).find((r) => r.task === task.id) : null;
    if (open) {
      const n = work.raised.indexOf(open) + 1;
      return refuse(`its question is unanswered: crew work ${work.slug} answer r${n} "<answer>"`);
    }
    setField(task.path, 'status', 'approved');
    clearField(task.path, 'blocked');
    clearField(task.path, 'blocked-by');
    logEvent(cfg, [task.path, 'sendback']);
  } else if (verb === 'block') {
    const [who, ...words] = rest;
    if (!BLOCKERS.includes(who)) return refuse(`who stopped it? one of ${BLOCKERS.join(', ')}`);
    // One line in the frontmatter: the detail belongs in the body, under Review rounds.
    const reason = oneLine(words).slice(0, 240);
    if (!reason)
      return refuse('say why, in one line — "blocked" on its own tells the person nothing');
    if (statuses(cfg)[task.meta.status]?.terminal) return refuse(`task is ${task.meta.status}`);
    setField(task.path, 'status', 'blocked');
    setField(task.path, 'blocked', reason);
    setField(task.path, 'blocked-by', who);
    logEvent(cfg, [task.path, 'block']);
  } else if (verb === 'question') {
    // The reviewer doubts the approach, not this diff: the person answers it
    // once for the whole group, and the tasks it names wait for that answer.
    const { affects, evidence, words } = questionArgs(rest);
    const q = oneLine(words);
    if (!q) return refuse('ask the question, in one line');
    if (statuses(cfg)[task.meta.status]?.terminal) return refuse(`task is ${task.meta.status}`);
    const slug = task.meta.work;
    const root = mainRoot(cfg);
    const work = slug && readWorks(root).find((w) => w.slug === slug);
    if (work) {
      const raised = [...(work.raised ?? [])];
      raised.push({ task: task.id, from: 'reviewer', q, evidence, affects, answer: null });
      saveWork(root, { ...work, raised });
      console.log(
        `question: r${raised.length} on ${slug}, holding ${[task.id, ...affects].join(', ')}`,
      );
    }
    setField(task.path, 'status', 'blocked');
    setField(task.path, 'blocked', `question: ${q}`.slice(0, 240));
    setField(task.path, 'blocked-by', 'reviewer');
    logEvent(cfg, [task.path, 'question']);
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
