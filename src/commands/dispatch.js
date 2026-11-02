// Hand an approved task to its own worktree: the part of /crew:crew-run that
// never needed a model.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { worktrees } from '../lib/changes.js';
import { CONFIG_PATH } from '../lib/config.js';
import { git } from '../lib/git.js';
import { branchFor, briefFor, cardFor, findTask, modelFor, worktreePath } from '../lib/handover.js';
import { setField } from '../lib/task.js';
import { run as board } from './board.js';
import { run as log } from './log.js';
import { findCollisions } from './preflight.js';

// board and log report on stdout, which --json keeps for the result alone.
const quietly = (fn) => {
  const out = console.log;
  console.log = console.error;
  try {
    return fn();
  } finally {
    console.log = out;
  }
};

/**
 * Everything short of starting the session. Returns `{ ok: false, reason }`
 * when it refuses; nothing on disk has changed then. Collisions are reported,
 * never refused.
 */
export const dispatch = (cfg, task) => {
  if (task.meta.status !== 'approved') {
    return { ok: false, reason: `task ${task.id} is ${task.meta.status}, not approved` };
  }

  const collisions = findCollisions(cfg, task);
  const branch = branchFor(cfg, task);
  const path = worktreePath(cfg, task);
  const existing = worktrees(cfg.root).find((tree) => tree.branch === branch);

  if (!existing) {
    if (existsSync(path)) {
      return { ok: false, reason: `${path} already exists and is not this task's worktree` };
    }
    const hasBranch = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cfg.root);
    // From the base branch, not HEAD: HEAD may be another task's tip while
    // the person is checking it out to test.
    const from = git(['rev-parse', '--verify', '--quiet', cfg.baseBranch], cfg.root)
      ? cfg.baseBranch
      : 'HEAD';
    const added = git(
      hasBranch ? ['worktree', 'add', path, branch] : ['worktree', 'add', path, '-b', branch, from],
      cfg.root,
    );
    if (added === null) return { ok: false, reason: `git worktree add ${path} failed` };
  }
  const tree = existing?.path ?? path;

  // .claude/ is gitignored, so a fresh worktree has none of what the gate
  // reads, nor a spec that was never committed.
  const copied = [];
  for (const rel of [CONFIG_PATH, cfg.projectBrief, relative(cfg.root, task.path)]) {
    const from = join(cfg.root, rel);
    const to = join(tree, rel);
    if (existsSync(to) || !existsSync(from)) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied.push(rel);
  }

  // Only the worktree's copy: the board reads it, and the main copy left alone
  // means the merge brings the worker's final status in without a conflict.
  const taskInTree = join(tree, relative(cfg.root, task.path));
  setField(taskInTree, 'status', 'building');

  quietly(() => {
    board(cfg, []);
    log(cfg, [taskInTree, 'dispatch']);
  });

  const model = modelFor(cfg, task);
  const brief = briefFor(cfg, task);
  return {
    ok: true,
    id: task.id,
    title: task.title,
    branch,
    worktree: tree,
    reused: Boolean(existing),
    copied,
    model,
    brief,
    command: `cd ${JSON.stringify(tree)} && claude --model ${model} ${JSON.stringify(brief)}`,
    card: cardFor(cfg, task, tree),
    collisions,
  };
};

export const run = (cfg, args) => {
  const json = args.includes('--json');
  const arg = args.find((a) => !a.startsWith('--'));

  const task = findTask(cfg, arg);
  if (!task) {
    if (json) console.log(JSON.stringify({ ok: false, reason: `no task "${arg ?? ''}"` }));
    else console.error('usage: crew dispatch <task id or file> [--json]');
    return 2;
  }

  const result = dispatch(cfg, task);
  if (json) {
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }

  if (!result.ok) {
    console.error(`dispatch: refused — ${result.reason}`);
    return 1;
  }

  console.log(`dispatch: ${result.id} → ${result.worktree} on ${result.branch}`);
  if (result.copied.length) console.log(`  copied in: ${result.copied.join(', ')}`);
  for (const hit of result.collisions) {
    console.log(`  collides: ${hit.branch}  ${hit.commit}  [${hit.path}]`);
  }
  console.log(`  model: ${result.model}`);
  console.log(`  brief: ${result.brief}`);
  return 0;
};
