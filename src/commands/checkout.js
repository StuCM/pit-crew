// Put a task's work where you run the project, to test it, and put it back.
//
// The task's own worktree is never touched. Git refuses to check a branch
// out in two worktrees, but not the commit it points at: the bench detaches
// at the branch's tip, so the worker can go on committing while it is tested.
// What the worker has not committed yet is not included, which is the point:
// what is tested is what would merge.
//
// The bench is its own worktree by default, at one fixed path, so a dev
// server or a compose file pointed at it once follows every checkout. It is
// not the main checkout because that is where the task files, the board and
// the log live: they change on every dispatch, so a switch there is refused
// on the normal path, and when it is not, the board shows another commit's
// statuses. `bench: "."` uses the main checkout anyway, for a stack that can
// only run from there; commit the bookkeeping first.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { worktrees } from '../lib/changes.js';
import { git, gitLines, gitTry } from '../lib/git.js';
import { branchFor, findTask, projectName } from '../lib/handover.js';

/** The main working tree: the first `git worktree list` entry. */
export const mainTree = (root) => worktrees(root)[0]?.path ?? root;

/** Where checkouts go: the configured bench, else `<project>-bench`. */
export const benchPath = (cfg) => {
  const main = mainTree(cfg.root);
  if (cfg.bench) return resolve(main, cfg.bench);
  return resolve(main, cfg.worktreeDir, `${projectName(cfg)}-bench`);
};

// Kept in the git directory, not a work tree: it must survive the very
// switch it records, and a work tree's `.claude/` changes with the commit.
const statePath = (root) => {
  const dir = git(['rev-parse', '--git-common-dir'], root)?.trim() || '.git';
  return join(isAbsolute(dir) ? dir : join(root, dir), 'crew-checkout.json');
};

export const readCheckout = (root) => {
  try {
    return JSON.parse(readFileSync(statePath(root), 'utf8'));
  } catch {
    return null;
  }
};

/** Tracked changes would be carried into, or lost by, the switch. */
const dirty = (tree) => gitLines(['status', '--porcelain', '--untracked-files=no'], tree);

const isWorktree = (root, path) => worktrees(root).some((w) => resolve(w.path) === path);

export const checkout = (cfg, task) => {
  const main = mainTree(cfg.root);
  const bench = benchPath(cfg);
  const branch = branchFor(cfg, task);
  const tip = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], main)?.trim();
  if (!tip) return { ok: false, reason: `no branch ${branch} on this machine` };

  const held = readCheckout(main);
  let from = held?.from ?? null;
  let fromSha = held?.fromSha ?? null;

  if (isWorktree(main, bench)) {
    const changed = dirty(bench);
    if (changed.length) {
      return {
        ok: false,
        reason: `${bench} has uncommitted changes — commit or stash them first`,
        changed,
      };
    }
    // Only the first switch records where to go back to; moving from one
    // task to another keeps the original.
    if (!held) {
      from = git(['symbolic-ref', '--short', '-q', 'HEAD'], bench)?.trim() || null;
      fromSha = git(['rev-parse', 'HEAD'], bench)?.trim();
    }
    const switched = gitTry(['switch', '--detach', tip], bench);
    if (!switched.ok) return { ok: false, reason: `git switch failed: ${switched.err}` };
  } else {
    if (existsSync(bench)) return { ok: false, reason: `${bench} exists and is not a worktree` };
    const added = gitTry(['worktree', 'add', '--detach', bench, tip], main);
    if (!added.ok) return { ok: false, reason: `git worktree add failed: ${added.err}` };
    from = null;
    fromSha = git(['rev-parse', '--verify', '--quiet', cfg.baseBranch], main)?.trim() ?? tip;
  }

  writeFileSync(
    statePath(main),
    `${JSON.stringify({ task: task.id, branch, tip, bench, from, fromSha, at: new Date().toISOString() })}\n`,
  );

  const tree = worktrees(main).find((w) => w.branch === branch);
  const pending = tree && existsSync(tree.path) ? dirty(tree.path).length : 0;
  return { ok: true, id: task.id, bench, branch, tip, uncommittedInWorktree: pending };
};

export const back = (cfg) => {
  const main = mainTree(cfg.root);
  const held = readCheckout(main);
  if (!held) return { ok: false, reason: 'nothing is checked out by crew' };
  const bench = held.bench ?? benchPath(cfg);

  const changed = dirty(bench);
  if (changed.length) {
    return {
      ok: false,
      reason: `${bench} has uncommitted changes — commit or stash them first`,
      changed,
    };
  }

  const switched = held.from
    ? gitTry(['switch', held.from], bench)
    : gitTry(['switch', '--detach', held.fromSha], bench);
  if (!switched.ok) return { ok: false, reason: `git switch failed: ${switched.err}` };

  rmSync(statePath(main), { force: true });
  return { ok: true, bench, to: held.from ?? held.fromSha };
};

export const run = (cfg, args) => {
  const json = args.includes('--json');
  const arg = args.find((a) => !a.startsWith('--'));

  let result;
  if (args.includes('--back')) {
    result = back(cfg);
  } else if (args.includes('--status')) {
    result = { ok: true, bench: benchPath(cfg), held: readCheckout(mainTree(cfg.root)) };
  } else {
    const task = findTask(cfg, arg);
    if (!task) {
      if (json) console.log(JSON.stringify({ ok: false, reason: `no task "${arg ?? ''}"` }));
      else console.error('usage: crew checkout <task> | --back | --status [--json]');
      return 2;
    }
    result = checkout(cfg, task);
  }

  if (json) {
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }
  if (!result.ok) {
    console.error(`checkout: ${result.reason}`);
    for (const line of result.changed ?? []) console.error(`  ${line}`);
    return 1;
  }
  if ('held' in result) {
    const { held } = result;
    console.log(
      held
        ? `checkout: ${result.bench} holds task ${held.task} (${held.branch} at ${held.tip.slice(0, 7)})`
        : `checkout: nothing checked out by crew; the bench is ${result.bench}`,
    );
  } else if (result.to) {
    console.log(`checkout: ${result.bench} is back on ${result.to.slice(0, 40)}`);
  } else {
    console.log(`checkout: ${result.bench} is at ${result.branch} (${result.tip.slice(0, 7)})`);
    if (result.uncommittedInWorktree) {
      console.log(
        `  the worker has ${result.uncommittedInWorktree} uncommitted change(s), not included`,
      );
    }
    console.log('  `crew checkout --back` when you are done');
  }
  return 0;
};
