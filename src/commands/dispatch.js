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
import { heldBy, pilotHolds, workPath } from './work.js';
import { readWorks } from '../lib/wall.js';

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
 * when it refuses; nothing on disk has changed then.
 */
export const dispatch = (cfg, task, { force = false } = {}) => {
  if (task.meta.status !== 'approved') {
    return { ok: false, reason: `task ${task.id} is ${task.meta.status}, not approved` };
  }

  // A reviewer's question about the approach holds every task it names, so
  // the next one is not built on the approach in doubt.
  const work = task.meta.work && readWorks(cfg.root).find((w) => w.slug === task.meta.work);
  const held = work && heldBy(work, task.id);
  if (!force && held) {
    return {
      ok: false,
      reason: `held by an open question from task ${held.task}: ${held.q} — answer it with crew work ${work.slug} answer`,
    };
  }

  const pilot = work && pilotHolds(cfg, work, task);
  if (!force && pilot) {
    return {
      ok: false,
      reason: `${pilot.id} pilots ${work.slug} and is ${pilot.meta.status}: the rest wait until it is done`,
    };
  }

  const collisions = findCollisions(cfg, task);
  if (!force && collisions.length) {
    return { ok: false, reason: 'unmerged branches already touch these files', collisions };
  }

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
  const briefFile = work ? relative(cfg.root, workPath(cfg.root, work.slug)) : null;
  for (const rel of [CONFIG_PATH, cfg.projectBrief, relative(cfg.root, task.path), briefFile]) {
    if (!rel) continue;
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
  const force = args.includes('--force');
  const arg = args.find((a) => !a.startsWith('--'));

  const task = findTask(cfg, arg);
  if (!task) {
    if (json) console.log(JSON.stringify({ ok: false, reason: `no task "${arg ?? ''}"` }));
    else console.error('usage: crew dispatch <task id or file> [--force] [--json]');
    return 2;
  }

  const result = dispatch(cfg, task, { force });
  if (json) {
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }

  if (!result.ok) {
    console.error(`dispatch: refused — ${result.reason}`);
    for (const hit of result.collisions ?? []) {
      console.error(`  ${hit.branch}  ${hit.commit}  [${hit.path}]`);
    }
    if (result.collisions?.length) {
      console.error('Land or respec around them, or pass --force if the person says proceed.');
    }
    return 1;
  }

  console.log(`dispatch: ${result.id} → ${result.worktree} on ${result.branch}`);
  if (result.copied.length) console.log(`  copied in: ${result.copied.join(', ')}`);
  if (result.collisions.length) console.log('  dispatched over collisions (--force)');
  console.log(`  model: ${result.model}`);
  console.log(`  brief: ${result.brief}`);
  return 0;
};
