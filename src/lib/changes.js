// What a task has actually changed, for the pit wall's review of a worktree
// while it is still running. Read from git, never from the worker's account
// of itself: the point is to check that nothing unnecessary was done.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { git, gitLines } from './git.js';
import { bookkeeping, declaredFiles, inScope } from './task.js';

const MAX_DIFF = 2 << 20;
const MAX_UNTRACKED = 40;

/** Every worktree of this repository, with the branch it has checked out. */
export const worktrees = (root) => {
  const out = [];
  let current = null;
  for (const line of (git(['worktree', 'list', '--porcelain'], root) ?? '').split('\n')) {
    if (line.startsWith('worktree ')) out.push((current = { path: line.slice(9), branch: null }));
    else if (line.startsWith('branch ') && current)
      current.branch = line.slice(7).replace(/^refs\/heads\//, '');
  }
  return out;
};

/** A unified diff, split into files and hunks the page can draw. */
export const parseDiff = (text) => {
  const files = [];
  let file = null;
  let hunk = null;
  let a = 0;
  let b = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const paths = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      file = {
        path: paths?.[2] ?? line.slice(11),
        oldPath: paths?.[1] ?? null,
        status: 'modified',
        binary: false,
        added: 0,
        removed: 0,
        hunks: [],
      };
      files.push(file);
      hunk = null;
    } else if (!file) continue;
    else if (line.startsWith('new file mode')) file.status = 'added';
    else if (line.startsWith('deleted file mode')) file.status = 'deleted';
    else if (line.startsWith('rename from ')) file.status = 'renamed';
    else if (line.startsWith('Binary files ')) file.binary = true;
    else if (line.startsWith('@@')) {
      const at = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
      a = Number(at?.[1] ?? 0);
      b = Number(at?.[2] ?? 0);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
    } else if (hunk && /^[ +-]/.test(line) && !line.startsWith('+++') && !line.startsWith('---')) {
      const kind = line[0];
      if (kind === '+') {
        hunk.lines.push({ kind, text: line.slice(1), b: b++ });
        file.added++;
      } else if (kind === '-') {
        hunk.lines.push({ kind, text: line.slice(1), a: a++ });
        file.removed++;
      } else hunk.lines.push({ kind, text: line.slice(1), a: a++, b: b++ });
    }
  }
  return files;
};

const baseOf = (cfg, branch) => {
  for (const ref of [cfg.baseBranch, `origin/${cfg.baseBranch}`]) {
    const out = git(['merge-base', branch, ref], cfg.root);
    if (out) return out.trim();
  }
  return null;
};

const DIFF = ['diff', '--no-color', '--no-ext-diff', '-M'];

// `git diff --no-index` exits 1 whenever the two sides differ, which is every
// time it is asked about a new file, so its output is kept on that exit too.
const newFileDiff = (path, cwd) => {
  try {
    return execFileSync('git', [...DIFF, '--no-index', '--', '/dev/null', path], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    return error.status === 1 ? String(error.stdout ?? '') : '';
  }
};

/**
 * Everything a task has changed against the point it branched from:
 * committed, uncommitted and untracked alike when its worktree is here, the
 * branch alone when it is not. Each file says whether `files:` allowed it.
 */
export const taskChanges = (cfg, task) => {
  const branch = task.meta.branch;
  if (!branch) return { error: 'the task names no branch' };
  if (!git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cfg.root)) {
    return { branch, error: 'the branch does not exist yet — nothing has been dispatched' };
  }
  const base = baseOf(cfg, branch);
  if (!base) return { branch, error: `no common history with ${cfg.baseBranch}` };

  const tree = worktrees(cfg.root).find((w) => w.branch === branch && existsSync(w.path));
  let text;
  const dirty = new Set();
  if (tree) {
    text = git([...DIFF, base], tree.path) ?? '';
    for (const path of gitLines(['diff', '--name-only', 'HEAD'], tree.path)) dirty.add(path);
    const untracked = gitLines(['ls-files', '--others', '--exclude-standard'], tree.path);
    for (const path of untracked.slice(0, MAX_UNTRACKED)) {
      dirty.add(path);
      text += `\n${newFileDiff(path, tree.path)}`;
    }
  } else {
    text = git([...DIFF, base, branch], cfg.root) ?? '';
  }

  const truncated = text.length > MAX_DIFF;
  const declared = declaredFiles(task);
  const kept = new Set(bookkeeping(cfg, task));
  const files = parseDiff(truncated ? text.slice(0, MAX_DIFF) : text);
  for (const file of files) {
    file.uncommitted = dirty.has(file.path);
    if (inScope(file.path, declared)) file.scope = 'declared';
    else file.scope = kept.has(file.path) ? 'bookkeeping' : 'outside';
  }

  const commits = gitLines(
    ['log', '--format=%H%x09%h%x09%cr%x09%s', `${base}..${branch}`],
    cfg.root,
  ).map((line) => {
    const [sha, short, when, subject] = line.split('\t');
    return { sha, short, when, subject };
  });

  return { branch, base, worktree: tree?.path ?? null, commits, files, truncated };
};

/** One commit's own diff, for stepping through a worker's history. */
export const commitChanges = (cfg, sha) => {
  if (!/^[0-9a-f]{7,40}$/.test(sha ?? '')) return { error: 'not a commit id' };
  const head = git(['show', '--no-patch', '--format=%h%x09%cr%x09%s', sha], cfg.root);
  if (!head) return { error: 'no such commit' };
  const [short, when, subject] = head.trim().split('\t');
  const text = git(['show', '--no-color', '--no-ext-diff', '-M', '--format=', sha], cfg.root) ?? '';
  return {
    sha,
    short,
    when,
    subject,
    files: parseDiff(text.slice(0, MAX_DIFF)),
    truncated: text.length > MAX_DIFF,
  };
};

/** The two sides of one file, for a side-by-side view in an editor. */
export const fileSides = (cfg, changes, path) => {
  const file = changes.files?.find((f) => f.path === path);
  if (!file) return null;
  const before = git(['show', `${changes.base}:${file.oldPath ?? path}`], cfg.root) ?? '';
  const after = changes.worktree
    ? join(changes.worktree, path)
    : (git(['show', `${changes.branch}:${path}`], cfg.root) ?? '');
  return { before, after, afterIsPath: Boolean(changes.worktree) };
};
