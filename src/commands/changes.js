// What a task or a whole group changed, read from git for the pit wall's
// review pane: the files, the commits, one commit's diff, a file as the
// branch has it, and a search of the code there. Nothing here needs the
// person to be in the worktree.

import { existsSync, readFileSync } from 'node:fs';
import { commitChanges, suggestionTarget, taskChanges } from '../lib/changes.js';
import { git } from '../lib/git.js';
import { findTask } from '../lib/handover.js';
import { readState, readWorks, safePath, writeState } from '../lib/wall.js';
import { tasksOf } from './work.js';

const MAX_LINES = 20000;
const MAX_HITS = 60;

const USAGE = `usage: crew changes <id|slug>                  files and commits, as JSON
       crew changes <id|slug> --commit <sha>   one commit's diff
       crew changes <id|slug> --file <path>    the file as the branch has it
       crew changes <id|slug> --grep <text>    search the code on the branch
       crew suggest <id> <path> <line|-> <note…>   a change for the fixer to fold in`;

/** The tasks a target names: one task by id, or every task in a group by its slug. */
const resolveTarget = (cfg, name) => {
  const task = /^\d+$/.test(name ?? '') && findTask(cfg, name);
  if (task) return { kind: 'task', title: task.title, tasks: [task] };
  const work = readWorks(cfg.root).find((w) => w.slug === name);
  if (work) return { kind: 'group', title: work.title ?? work.slug, tasks: tasksOf(cfg, work) };
  return null;
};

/** Every task's changes, files tagged with their task so a group shows whose each one is. */
export const changesFor = (cfg, target) => {
  const files = [];
  const commits = [];
  const missing = [];
  for (const task of target.tasks) {
    const c = taskChanges(cfg, task);
    if (c.error) {
      missing.push({ task: task.id, reason: c.error });
      continue;
    }
    for (const f of c.files) files.push({ ...f, task: task.id });
    for (const commit of c.commits) commits.push({ ...commit, task: task.id });
  }
  return { kind: target.kind, title: target.title, files, commits, missing };
};

// The file at the tip a reviewer means: the worktree when it is here, so
// uncommitted work shows, else the branch.
const fileAt = (cfg, task, path) => {
  const c = taskChanges(cfg, task);
  if (!c.error && c.worktree) {
    const full = safePath(c.worktree, path);
    return full && existsSync(full) ? readFileSync(full, 'utf8') : null;
  }
  return task.meta.branch ? git(['show', `${task.meta.branch}:${path}`], cfg.root) : null;
};

const grepIn = (cfg, task, text) => {
  const branch = task.meta.branch;
  if (!branch || !git(['rev-parse', '--verify', '--quiet', branch], cfg.root)) return [];
  const out =
    git(['grep', '-n', '-I', '-F', '--full-name', '-e', text, branch, '--'], cfg.root) ?? '';
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [, path, at, ...rest] = line.split(':');
      return { path, line: Number(at), text: rest.join(':').trim().slice(0, 200) };
    });
};

const flag = (args, name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? '');
};

export const run = (cfg, args = []) => {
  const [name] = args;
  const target = name && resolveTarget(cfg, name);
  if (!target) {
    console.error(name ? `changes: no task or group "${name}"` : USAGE);
    return name ? 1 : 2;
  }

  const sha = flag(args, '--commit');
  const path = flag(args, '--file');
  const text = flag(args, '--grep');
  let out;
  if (sha !== null) out = commitChanges(cfg, sha);
  else if (path !== null) {
    // In a group, the file as the task that changed it last has it.
    const owner =
      target.tasks
        .toReversed()
        .find((t) => taskChanges(cfg, t).files?.some((f) => f.path === path)) ??
      target.tasks.at(-1);
    const source = owner ? fileAt(cfg, owner, path) : null;
    out =
      source === null
        ? { error: `${path} is not on the branch` }
        : { path, task: owner.id, lines: source.split('\n').slice(0, MAX_LINES) };
  } else if (text !== null) {
    if (!text.trim()) out = { error: 'nothing to search for' };
    else {
      const seen = new Set();
      const hits = [];
      for (const task of target.tasks) {
        for (const hit of grepIn(cfg, task, text)) {
          const key = `${hit.path}:${hit.line}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({ ...hit, task: task.id });
        }
      }
      out = { text, hits: hits.slice(0, MAX_HITS), more: Math.max(hits.length - MAX_HITS, 0) };
    }
  } else {
    out = changesFor(cfg, target);
    // The pane shows how many changes wait for the fixer, per task.
    out.suggestions = (readState(cfg.root).suggestions ?? []).filter(
      (s) => s.status === 'open' && target.tasks.some((t) => t.id === s.task),
    );
  }

  console.log(JSON.stringify(out));
  return out.error ? 1 : 0;
};

/** `crew suggest`: one suggestion for the fixer, aimed at the commit that owns its line. */
export const suggest = (cfg, [id, path, at, ...words] = []) => {
  const task = id && findTask(cfg, id);
  const note = words.join(' ').trim();
  if (!task || !path || !note) {
    console.error(task || !id ? USAGE : `suggest: no task ${id}`);
    return task || !id ? 2 : 1;
  }
  const changes = taskChanges(cfg, task);
  if (changes.error) {
    console.error(`suggest: ${changes.error}`);
    return 1;
  }
  const line = /^\d+$/.test(at ?? '') ? Number(at) : null;
  const source = fileAt(cfg, task, path)?.split('\n') ?? [];
  const state = readState(cfg.root);
  state.suggestions ??= [];
  const item = {
    id: `s${Date.now().toString(36)}${state.suggestions.length}`,
    task: task.id,
    path,
    line,
    quote: line ? (source[line - 1] ?? '') : '',
    note,
    replacement: '',
    target: suggestionTarget(cfg, changes, path, line, 'new'),
    status: 'open',
  };
  state.suggestions.push(item);
  writeState(cfg.root, state);
  const where =
    item.target.kind === 'fixup'
      ? `fold into ${item.target.short} ${item.target.subject}`
      : item.target.kind;
  console.log(`suggest: recorded on ${task.id} (${where}); apply with crew fix ${task.id}`);
  return 0;
};
