// What every route that hands a task over has to agree on: which task an
// argument means, where its worktree goes, and the brief its session starts
// with. The skill, the pit wall and the mod all read these, so the brief a
// session gets does not depend on which of them started it.

import { basename, join, relative, resolve } from 'node:path';
import { readTask, readTasks } from './task.js';

/** A task by id (`7`, `007`) or by path. Null if neither finds one. */
export const findTask = (cfg, arg) => {
  if (arg == null || arg === '') return null;
  const text = String(arg);
  if (/^\d+$/.test(text)) {
    const id = text.padStart(3, '0');
    return readTasks(join(cfg.root, cfg.tasksDir)).find((task) => task.id === id) ?? null;
  }
  const path = resolve(cfg.root, text);
  try {
    return readTask(path, relative(cfg.root, path));
  } catch {
    return null;
  }
};

/** The name worktrees are prefixed with: the project, else the folder. */
export const projectName = (cfg) =>
  cfg.project && cfg.project !== 'CHANGE-ME' ? cfg.project : basename(cfg.root);

export const worktreePath = (cfg, task) =>
  resolve(cfg.root, cfg.worktreeDir, `${projectName(cfg)}-${task.id}`);

export const branchFor = (cfg, task) =>
  task.meta.branch || `${cfg.branchPrefix}${task.id}-${task.meta.slug || 'task'}`;

export const modelFor = (cfg, task) => task.meta.model || cfg.models.default;

/** Exactly the brief crew-run hands over, and nothing more. */
export const briefFor = (cfg, task) =>
  `Use the crew-worker skill for task ${join(cfg.tasksDir, basename(task.path))}. ` +
  'You are in a worktree; the spec is the brief.';

/**
 * The card the desktop app shows for a task: one click starts a session on
 * this machine, in the main checkout. The card cannot pick a folder or a
 * model, so its prompt moves the session into the task's worktree before
 * anything else — the scope hook identifies the task from the branch there —
 * and says which model the spec chose.
 */
export const cardFor = (cfg, task, worktree) => {
  const title = `Task ${task.id}: ${task.title}`;
  return {
    title: title.length > 58 ? `${title.slice(0, 57)}…` : title,
    tldr:
      `Builds task ${task.id} in its own worktree, ${basename(worktree)}, on ${branchFor(cfg, task)}. ` +
      'Start it on your machine, without a fresh worktree: it moves into its own.',
    prompt: [
      `Task ${task.id}: ${task.title}. You are the crew worker for this task.`,
      '',
      `1. Before anything else, enter the task's worktree: load the EnterWorktree tool and call it with \`path: ${JSON.stringify(worktree)}\`. Do not read or change anything in the checkout you started in.`,
      `2. The spec chose the model \`${modelFor(cfg, task)}\`. If you are running on another, say so in one line so the person can switch with /model, then carry on.`,
      `3. ${briefFor(cfg, task)}`,
    ].join('\n'),
  };
};
