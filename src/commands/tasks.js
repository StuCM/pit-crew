// The board as data, for anything that draws it: the mod's pane reads this
// rather than parsing task files itself, so there is still one parser.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { statuses } from '../lib/config.js';
import { worktrees } from '../lib/changes.js';
import { git, gitLines } from '../lib/git.js';
import { branchFor, briefFor, modelFor, projectName, worktreePath } from '../lib/handover.js';
import { declaredFiles, readTasks } from '../lib/task.js';
import { mainTree, readCheckout } from './checkout.js';

export const snapshot = (cfg) => {
  const known = statuses(cfg);
  const trees = worktrees(cfg.root);
  const live = new Set(
    gitLines(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], cfg.root),
  );

  const tasks = readTasks(join(cfg.root, cfg.tasksDir)).map((task) => {
    const status = task.meta.status ?? '?';
    const branch = branchFor(cfg, task);
    const tree = trees.find((w) => w.branch === branch && existsSync(w.path));
    const hasBranch = live.has(branch);
    const ahead = hasBranch
      ? Number(git(['rev-list', '--count', `${cfg.baseBranch}..${branch}`], cfg.root) ?? 0)
      : 0;
    const uncommitted = tree ? gitLines(['status', '--porcelain'], tree.path).length : 0;
    return {
      id: task.id,
      title: task.title,
      status,
      path: task.path,
      branch,
      hasBranch,
      model: modelFor(cfg, task),
      files: declaredFiles(task),
      rounds: Number(task.meta.rounds || 0),
      waitsOnUser: known[status]?.waitsOnUser ?? null,
      inFlight: Boolean(known[status]?.inFlight),
      terminal: Boolean(known[status]?.terminal),
      worktree: tree?.path ?? null,
      plannedWorktree: worktreePath(cfg, task),
      ahead: Number.isFinite(ahead) ? ahead : 0,
      uncommitted,
      brief: briefFor(cfg, task),
    };
  });

  return {
    project: projectName(cfg),
    root: cfg.root,
    main: mainTree(cfg.root),
    baseBranch: cfg.baseBranch,
    reviewRounds: cfg.reviewRounds,
    checkout: readCheckout(mainTree(cfg.root)),
    tasks,
  };
};

export const run = (cfg, args) => {
  const data = snapshot(cfg);
  if (args.includes('--json')) {
    console.log(JSON.stringify(data));
    return 0;
  }
  for (const task of data.tasks) {
    const where = task.worktree ? ` in ${task.worktree}` : '';
    console.log(`${task.id}  ${task.status.padEnd(10)} ${task.title}${where}`);
  }
  if (data.checkout)
    console.log(`\nchecked out: task ${data.checkout.task} (${data.checkout.branch})`);
  return 0;
};
