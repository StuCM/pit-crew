// Hand an approved task to its own worktree: the part of /crew:crew-run that
// never needed a model. The skill, the pit wall's button and the mod's all
// call this, so a collision stops a dispatch whichever of them asked.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { statuses } from '../lib/config.js';
import { worktrees } from '../lib/changes.js';
import { git, gitTry } from '../lib/git.js';
import { branchFor, briefFor, findTask, modelFor, worktreePath } from '../lib/handover.js';
import { declaredFiles, matches, readTasks, setField } from '../lib/task.js';
import { writeBoard } from './board.js';
import { appendLog } from './log.js';
import { findCollisions } from './preflight.js';

const overlaps = (a, b) => a === b || matches(a, b) || matches(b, a);

/** In-flight tasks declaring any of the same files, as `{ id, title, files }`. */
export const inFlightOverlaps = (cfg, task) => {
  const known = statuses(cfg);
  const mine = declaredFiles(task);
  return readTasks(join(cfg.root, cfg.tasksDir))
    .filter((other) => other.id !== task.id && known[other.meta.status]?.inFlight)
    .map((other) => ({
      id: other.id,
      title: other.title,
      files: declaredFiles(other).filter((path) => mine.some((own) => overlaps(own, path))),
    }))
    .filter((other) => other.files.length);
};

/**
 * Everything short of starting the session. Returns `{ ok: false, reason }`
 * when it refuses, with the overlaps and collisions that made it; nothing on
 * disk has changed then.
 */
export const dispatch = (cfg, task, { force = false } = {}) => {
  if (task.meta.status !== 'approved') {
    return { ok: false, reason: `task ${task.id} is ${task.meta.status}, not approved` };
  }

  // The board only sees tasks, and git only sees branches: ask both.
  const busy = inFlightOverlaps(cfg, task);
  const collisions = findCollisions(cfg, task);
  if (!force && (busy.length || collisions.length)) {
    return {
      ok: false,
      reason: 'other work already touches these files',
      overlaps: busy,
      collisions,
    };
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
    const added = gitTry(
      hasBranch ? ['worktree', 'add', path, branch] : ['worktree', 'add', path, '-b', branch, from],
      cfg.root,
    );
    if (!added.ok) return { ok: false, reason: `git worktree add failed: ${added.err}` };
  }
  const tree = existing?.path ?? path;

  setField(task.path, 'status', 'building');

  // A spec written but not yet committed is not on the branch, and the
  // session's whole brief is that file.
  const rel = relative(cfg.root, task.path);
  const inTree = join(tree, rel);
  const copied = !existsSync(inTree);
  if (copied) {
    mkdirSync(dirname(inTree), { recursive: true });
    copyFileSync(task.path, inTree);
  }

  writeBoard(cfg);
  appendLog(cfg, task.path, 'dispatch');

  const model = modelFor(cfg, task);
  const brief = briefFor(cfg, task);
  return {
    ok: true,
    id: task.id,
    title: task.title,
    branch,
    worktree: tree,
    reused: Boolean(existing),
    specCopied: copied,
    model,
    brief,
    command: `cd ${JSON.stringify(tree)} && claude --model ${model} ${JSON.stringify(brief)}`,
    overlaps: busy,
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
    for (const other of result.overlaps ?? []) {
      console.error(
        `  task ${other.id} (${other.title}) is in flight on ${other.files.join(', ')}`,
      );
    }
    for (const hit of result.collisions ?? []) {
      console.error(`  ${hit.branch}  ${hit.commit}  [${hit.path}]`);
    }
    if (result.overlaps?.length || result.collisions?.length) {
      console.error('Land or respec around them, or pass --force if the person says proceed.');
    }
    return 1;
  }

  console.log(`dispatch: ${result.id} → ${result.worktree} on ${result.branch}`);
  if (result.specCopied)
    console.log('  the spec is not committed, so it was copied into the worktree');
  if (result.overlaps.length || result.collisions.length)
    console.log('  dispatched over collisions (--force)');
  console.log(`  model: ${result.model}`);
  console.log(`\n${result.command}`);
  return 0;
};
