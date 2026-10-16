// The pit wall's worktree controls: what every worktree of the repository
// holds, and moving the main checkout onto a task's branch and back, so the
// work can be tried where the person already has everything open.
// Nothing here forces, stashes or discards: a dirty tree is a refusal.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { branches, git, gitLines } from './git.js';
import { worktrees } from './changes.js';
import { frontmatter, readTasks } from './task.js';

const exec = promisify(execFile);

const dirtyFiles = (path) => gitLines(['status', '--porcelain'], path);

const isGone = (tree) => tree.prunable || !existsSync(tree.path);

// Branch names come from the page, so only one that exists here is passed on.
const isBranch = (cfg, name) =>
  typeof name === 'string' && !name.startsWith('-') && branches(cfg.root).includes(name);

const baseRef = (cfg) =>
  [cfg.baseBranch, `origin/${cfg.baseBranch}`].find((ref) =>
    git(['rev-parse', '--verify', '--quiet', ref], cfg.root),
  ) ?? null;

const isMerged = (cfg, base, ref) =>
  Boolean(base && ref) && git(['merge-base', '--is-ancestor', ref, base], cfg.root) !== null;

const aheadBehind = (cfg, base, ref) => {
  const out =
    base && ref && git(['rev-list', '--left-right', '--count', `${base}...${ref}`], cfg.root);
  if (!out) return { ahead: null, behind: null };
  const [behind, ahead] = out.trim().split(/\s+/).map(Number);
  return { ahead, behind };
};

const returnFile = (main) =>
  resolve(main, git(['rev-parse', '--git-path', 'crew-return.json'], main).trim());

const readReturn = (main) => {
  try {
    return JSON.parse(readFileSync(returnFile(main), 'utf8'));
  } catch {
    return null;
  }
};

const taskFor = (cfg, tasks, tree) =>
  tasks.find(
    (t) =>
      (tree.branch && t.meta.branch === tree.branch) ||
      resolve(cfg.root, cfg.worktreeDir, `${cfg.project}-${t.id}`) === tree.path,
  ) ?? null;

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const withText = (task, text) => ({
  ...task,
  text,
  meta: frontmatter(text),
  title: /^#\s+(.+)$/m.exec(text)?.[1].trim() ?? task.file,
});

/** The tasks as workers have left them: a dirty worktree copy, else an unmerged task's own branch, over the main checkout's. */
export const readLiveTasks = (cfg) => {
  const tasks = readTasks(join(cfg.root, cfg.tasksDir));
  const base = baseRef(cfg);
  const local = branches(cfg.root);
  const trees = worktrees(cfg.root);
  return tasks.map((task) => {
    const branch = task.meta.branch;
    if (!local.includes(branch)) return task;
    const rel = `${cfg.tasksDir}/${task.file}`;
    const tree = trees.find((t) => taskFor(cfg, [task], t));
    const dirty =
      tree && !isGone(tree) && gitLines(['status', '--porcelain', '--', rel], tree.path).length;
    // Before the merged check: a just-dispatched branch has no commits, so it
    // counts as merged while its worktree copy already says building.
    const edited = dirty && readText(join(tree.path, rel));
    if (edited) return withText(task, edited);
    if (isMerged(cfg, base, branch)) return task;
    const text = git(['show', `${branch}:${rel}`], cfg.root);
    return text ? withText(task, text) : task;
  });
};

/** Every worktree, crew's or not, with what state it is in against the base branch. */
export const listWorktrees = (cfg) => {
  const base = baseRef(cfg);
  const local = branches(cfg.root);
  const tasks = readLiveTasks(cfg);
  const list = worktrees(cfg.root).map((tree, i) => {
    const task = taskFor(cfg, tasks, tree);
    const ref = tree.branch ?? tree.head;
    const gone = isGone(tree);
    // A finished worker detaches, so its branch is only found through its task.
    const taskBranch = local.includes(task?.meta.branch) ? task.meta.branch : null;
    const { ahead, behind } = aheadBehind(cfg, base, ref);
    return {
      path: tree.path,
      main: i === 0,
      branch: tree.branch,
      sha: tree.head?.slice(0, 7) ?? null,
      checkout: tree.branch ?? taskBranch,
      missing: gone,
      dirty: gone ? [] : dirtyFiles(tree.path),
      ahead,
      behind,
      merged: isMerged(cfg, base, ref),
      task: task && { id: task.id, title: task.title, status: task.meta.status ?? null },
    };
  });
  const main = list[0];
  return {
    base: cfg.baseBranch,
    returnTo: main ? (readReturn(main.path)?.from ?? null) : null,
    worktrees: list,
  };
};

const switchMain = (main, branch) => {
  if (git(['switch', branch], main) !== null) return { ok: true };
  const hidden = gitLines(['ls-files', '-v'], main)
    .filter((line) => line.startsWith('S '))
    .map((line) => line.slice(2));
  if (hidden.length) {
    return {
      error: `git would not switch to ${branch}. These files are marked skip-worktree, which blocks a switch when the branch changes them: ${hidden.join(', ')}. Clear it with git update-index --no-skip-worktree, deal with the edits, and try again.`,
    };
  }
  return { error: `git would not switch the main checkout to ${branch}` };
};

const dirtyError = (where, files) =>
  `${where} has uncommitted changes: ${files.slice(0, 20).join(', ')}${files.length > 20 ? ', …' : ''}`;

/** Put the main checkout on `branch`, freeing it from its worktree first. */
export const checkoutInMain = (cfg, branch) => {
  if (!isBranch(cfg, branch)) return { error: 'not a local branch' };
  const [main, ...others] = worktrees(cfg.root);
  if (main.branch === branch) return { ok: true, branch };
  const dirty = dirtyFiles(main.path);
  if (dirty.length) return { error: dirtyError('the main checkout', dirty) };

  const holder = others.find((w) => w.branch === branch);
  if (holder) {
    if (isGone(holder)) {
      return { error: `${branch} is held by a worktree that is gone from disk — prune first` };
    }
    const busy = dirtyFiles(holder.path);
    if (busy.length) return { error: dirtyError(holder.path, busy) };
    // git will not check one branch out in two places, so the worktree lets
    // go of it; its files stay exactly as they are, on the same commit.
    if (git(['switch', '--detach'], holder.path) === null) {
      return { error: `could not detach ${holder.path}` };
    }
  }

  const saved = readReturn(main.path);
  // Hopping from one task branch to the next still returns to where it began.
  const from = saved && saved.to === main.branch ? saved.from : main.branch;
  const switched = switchMain(main.path, branch);
  if (switched.error) {
    if (holder) git(['switch', branch], holder.path);
    return switched;
  }
  writeFileSync(returnFile(main.path), JSON.stringify({ from, to: branch }));
  return { ok: true, branch, from };
};

/** Put the main checkout back on the branch it was on before, or the base. */
export const backToBase = (cfg) => {
  const [main, ...others] = worktrees(cfg.root);
  const target = readReturn(main.path)?.from ?? cfg.baseBranch;
  if (!isBranch(cfg, target)) return { error: `${target} is not a local branch` };
  if (main.branch !== target) {
    const dirty = dirtyFiles(main.path);
    if (dirty.length) return { error: dirtyError('the main checkout', dirty) };
    const holder = others.find((w) => w.branch === target);
    if (holder) return { error: `${target} is checked out in ${holder.path}` };
    const switched = switchMain(main.path, target);
    if (switched.error) return switched;
  }
  rmSync(returnFile(main.path), { force: true });
  return { ok: true, branch: target };
};

/**
 * Remove a worktree, never its branch. Unmerged work needs `confirm`; a
 * dirty worktree is refused outright, since only --force would take it.
 */
export const removeWorktree = (cfg, path, confirm = false) => {
  const tree = worktrees(cfg.root)
    .slice(1)
    .find((w) => w.path === path);
  if (!tree) return { error: 'not a worktree of this repository' };
  if (isGone(tree)) return { error: 'that worktree is already gone from disk — prune instead' };
  const dirty = dirtyFiles(tree.path);
  if (dirty.length) return { error: dirtyError(tree.path, dirty) };
  if (!confirm && !isMerged(cfg, baseRef(cfg), tree.branch ?? tree.head)) {
    return {
      confirm: `${tree.branch ?? tree.path} is not merged into ${cfg.baseBranch}. Remove the worktree anyway? The branch is kept.`,
    };
  }
  if (git(['worktree', 'remove', tree.path], cfg.root) === null) {
    return { error: `git would not remove ${tree.path} — is it locked?` };
  }
  return { ok: true };
};

export const pruneWorktrees = (cfg) =>
  git(['worktree', 'prune'], cfg.root) === null
    ? { error: 'git worktree prune failed' }
    : { ok: true };

/** The branch's pull request, opened with gh if there is none yet. */
export const openPr = async (cfg, branch, gh = 'gh') => {
  if (!isBranch(cfg, branch)) return { error: 'not a local branch' };
  if (branch === cfg.baseBranch) return { error: `${branch} is the base branch` };
  if (git(['push', '-u', 'origin', branch], cfg.root) === null) {
    return { error: `could not push ${branch} to origin` };
  }
  try {
    const { stdout } = await exec(gh, ['pr', 'view', branch, '--json', 'url,state'], {
      cwd: cfg.root,
    });
    return { ok: true, ...JSON.parse(stdout) };
  } catch {}
  try {
    const { stdout } = await exec(
      gh,
      ['pr', 'create', '--fill', '--head', branch, '--base', cfg.baseBranch],
      { cwd: cfg.root },
    );
    return { ok: true, url: stdout.trim().split('\n').at(-1), state: 'OPEN' };
  } catch (error) {
    if (error.code === 'ENOENT') return { error: `${gh} is not on PATH` };
    return {
      error: String(error.stderr || error.message)
        .trim()
        .slice(0, 600),
    };
  }
};
