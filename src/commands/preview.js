// `crew preview`: point the one running copy of the app at a task, a group
// or the base branch, and bring a quick fix made while trying it back to
// the task's branch, folded into the commit it belongs in.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worktrees } from '../lib/changes.js';
import { git, gitLines } from '../lib/git.js';
import { findTask } from '../lib/handover.js';
import { readWorks } from '../lib/wall.js';
import { readLiveTasks } from '../lib/worktrees.js';
import {
  applyOverlay,
  editsIn,
  peekEdits,
  previewConfig,
  readPreview,
  removeOverlay,
  runSteps,
  switchPreview,
  writePreview,
} from '../lib/preview.js';
import { editBody } from './task.js';
import { tasksOf } from './work.js';

const USAGE = `usage: crew preview init            create the preview worktree from preview in the config
       crew preview <id>            show a task's branch
       crew preview group <slug>    show a group's branches merged over the base
       crew preview main            show the base branch
       crew preview status [--json] what it shows, and any edits made there
       crew preview keep [--to <id>]  fold the edits made there into the task's commits
       crew preview drop            throw the edits made there away`;

// Edits are never folded into a branch an agent is writing to.
const BUSY = new Set(['building', 'review']);

const say = (lines) => console.log(lines.filter(Boolean).join('\n'));
const refuse = (why) => {
  console.error(`preview: ${why}`);
  return 1;
};

/** What a task or group preview shows: the commit and branches to put there. */
const targetOf = (cfg, kind, id) => {
  if (kind === 'base')
    return { kind, id: cfg.baseBranch, label: cfg.baseBranch, base: cfg.baseBranch, branches: [] };
  if (kind === 'task') {
    const task = findTask(cfg, id);
    const branch = task?.meta.branch;
    if (!branch || !git(['rev-parse', '--verify', '--quiet', branch], cfg.root))
      return {
        error: task ? `${task.id} has no branch yet — nothing has been built` : `no task ${id}`,
      };
    return { kind, id: task.id, label: `${task.id} ${task.title}`, base: branch, branches: [] };
  }
  const work = readWorks(cfg.root).find((w) => w.slug === id);
  if (!work) return { error: `no group ${id}` };
  const branches = tasksOf(cfg, work)
    .map((t) => t.meta.branch)
    .filter((b) => b && git(['rev-parse', '--verify', '--quiet', b], cfg.root));
  if (!branches.length) return { error: `nothing in ${id} has a branch yet` };
  return { kind, id, label: work.title ?? id, base: cfg.baseBranch, branches };
};

const report = (result, pv) => {
  const { state } = result;
  say([
    `preview: showing ${state.label} (${state.sha.slice(0, 7)}) in ${pv.dir}`,
    result.overlay && `  overlay: ${result.overlay}`,
    result.migrations.length &&
      `  ⚠ migrations changed — the preview shares its database, so run or roll them back by hand:\n    ${result.migrations.join('\n    ')}`,
    result.dependencies.length &&
      `  ⚠ dependencies changed — the stack may need a rebuild: ${result.dependencies.join(', ')}`,
  ]);
  for (const step of runSteps(pv, result.run)) {
    say([
      `  ran ${step.run}: ${step.ok ? 'ok' : 'failed'}`,
      !step.ok && `    ${step.tail.join('\n    ')}`,
    ]);
    if (!step.ok) return 1;
  }
  return 0;
};

const show = (cfg, pv, kind, id) => {
  if (!existsSync(pv.dir)) return refuse(`no preview at ${pv.dir} — run crew preview init`);
  const target = targetOf(cfg, kind, id);
  if (target.error) return refuse(target.error);
  const result = switchPreview(pv, target);
  if (result.error) return refuse(result.error);
  return report(result, pv);
};

const init = (cfg, pv) => {
  if (existsSync(pv.dir)) return refuse(`${pv.dir} already exists`);
  if (git(['worktree', 'add', '-q', '--detach', pv.dir, cfg.baseBranch], cfg.root) === null)
    return refuse(`git worktree add ${pv.dir} failed`);
  const laid = applyOverlay(pv);
  const sha = git(['rev-parse', 'HEAD'], pv.dir).trim();
  writePreview(pv, {
    kind: 'base',
    id: cfg.baseBranch,
    label: cfg.baseBranch,
    base: cfg.baseBranch,
    branches: [],
    sha,
    at: new Date().toISOString(),
  });
  say([
    `preview: created ${pv.dir} on ${cfg.baseBranch}`,
    laid.error && `  overlay: ${laid.error}`,
    pv.start
      ? `  start it once, and leave it running: cd ${JSON.stringify(pv.dir)} && ${pv.start}`
      : '  set preview.start to say how the stack starts',
  ]);
  return laid.error ? 1 : 0;
};

/** What the preview shows and the edits made there, read without writing a file. */
export const status = (cfg, pv) => {
  if (!existsSync(pv.dir)) return { error: 'no preview yet' };
  return { dir: pv.dir, state: readPreview(pv), edits: peekEdits(pv) };
};

// Which task each edited file belongs to: in a group, the one whose branch changed it.
const ownersOf = (cfg, state, tasks, paths, to) => {
  const owner = {};
  const unclear = [];
  for (const path of paths) {
    if (state.kind === 'task') {
      owner[path] = state.id;
      continue;
    }
    const mine = tasks.filter((t) =>
      gitLines(['diff', '--name-only', `${cfg.baseBranch}...${t.meta.branch}`], cfg.root).includes(
        path,
      ),
    );
    if (mine.length === 1) owner[path] = mine[0].id;
    else if (to) owner[path] = to;
    else
      unclear.push(
        `${path} (${mine.length ? `changed by ${mine.map((t) => t.id).join(' and ')}` : 'no task changed it'})`,
      );
  }
  return { owner, unclear };
};

const rebaseEnv = {
  ...process.env,
  GIT_SEQUENCE_EDITOR: 'true',
  GIT_EDITOR: 'true',
  GIT_TERMINAL_PROMPT: '0',
};

/**
 * Apply one task's share of the edits on its branch, as a fixup of the last
 * commit to touch each file (or one new commit for files it never touched),
 * then fold the fixups in. Runs in the task's worktree, or a throwaway one.
 */
const foldInto = (cfg, task, files, patch) => {
  const branch = task.meta.branch;
  const base = git(['merge-base', cfg.baseBranch, branch], cfg.root)?.trim();
  let tree = worktrees(cfg.root).find((w) => w.branch === branch && existsSync(w.path))?.path;
  const temporary = !tree;
  if (temporary) {
    tree = join(mkdtempSync(join(tmpdir(), 'crew-fold-')), 'tree');
    if (git(['worktree', 'add', '-q', tree, branch], cfg.root) === null)
      return { task: task.id, error: `could not check out ${branch}` };
  }
  const done = (result) => {
    if (temporary) git(['worktree', 'remove', '--force', tree], cfg.root);
    return { task: task.id, files, ...result };
  };
  if (gitLines(['status', '--porcelain', '--untracked-files=no'], tree).length)
    return done({ error: `${branch}'s worktree has uncommitted changes` });

  const patchPath = join(tmpdir(), `crew-keep-${task.id}-${process.pid}.diff`);
  writeFileSync(patchPath, patch);
  const applied = git(['apply', '--index', '--whitespace=nowarn', patchPath], tree);
  rmSync(patchPath, { force: true });
  if (applied === null)
    return done({
      error: `the edits no longer apply to ${branch} — it moved since the preview switched`,
    });

  const fresh = [];
  let fixups = 0;
  for (const file of files) {
    const sha = git(['log', '-1', '--format=%H', `${base}..HEAD`, '--', file], tree)?.trim();
    if (sha) {
      git(['commit', '-q', `--fixup=${sha}`, '--', file], tree);
      fixups++;
    } else fresh.push(file);
  }
  if (fresh.length)
    git(['commit', '-q', '-m', 'fix: hand edit from the preview', '--', ...fresh], tree);

  let folded = true;
  if (fixups) {
    try {
      execFileSync('git', ['rebase', '-q', '-i', '--autosquash', base], {
        cwd: tree,
        env: rebaseEnv,
        stdio: 'ignore',
      });
    } catch {
      git(['rebase', '--abort'], tree);
      folded = false;
    }
  }

  // An edit no reviewer saw goes on the record where the reviewer's rounds are.
  const rel = join(cfg.tasksDir, task.file);
  const taskPath = existsSync(join(tree, rel)) && !temporary ? join(tree, rel) : task.path;
  const text = readFileSync(taskPath, 'utf8');
  const fence = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)?.[0] ?? '';
  const noted = editBody(text.slice(fence.length), {
    section: 'Review rounds',
    append: `Hand edit from the preview, not reviewed: ${files.join(', ')}${folded ? '' : ' (left as fixup! commits: the fold-in conflicted)'}`,
  });
  if (!noted.error) writeFileSync(taskPath, fence + noted.body);
  return done({ ok: true, folded });
};

const keep = (cfg, pv, to) => {
  const state = readPreview(pv);
  if (!state || state.kind === 'base')
    return refuse('the preview shows the base branch — there is no task to keep edits on');
  const off = removeOverlay(pv);
  if (off.error) return refuse(off.error);
  const back = (why) => {
    applyOverlay(pv);
    return refuse(why);
  };
  const edits = editsIn(pv);
  if (!edits.length) return back('no edits to keep');

  const tasks =
    state.kind === 'task'
      ? [findTask(cfg, state.id)]
      : tasksOf(cfg, readWorks(cfg.root).find((w) => w.slug === state.id) ?? { slug: state.id });
  const paths = edits.map((e) => e.path);
  const { owner, unclear } = ownersOf(cfg, state, tasks, paths, to);
  if (unclear.length)
    return back(`which task does each belong to? ${unclear.join('; ')} — say with --to <id>`);

  const live = Object.fromEntries(readLiveTasks(cfg).map((t) => [t.id, t.meta.status]));
  const ids = [...new Set(Object.values(owner))];
  const busy = ids.filter((id) => BUSY.has(live[id]));
  if (busy.length)
    return back(
      `${busy.join(', ')} ${busy.length > 1 ? 'are' : 'is'} still being built or reviewed — keep once it stops`,
    );

  git(['add', '-A'], pv.dir);
  const results = ids.map((id) => {
    const files = paths.filter((p) => owner[p] === id);
    const patch = git(['diff', '--cached', '--binary', '--', ...files], pv.dir) ?? '';
    return foldInto(cfg, findTask(cfg, id), files, patch);
  });
  git(['reset', '-q'], pv.dir);

  // What was kept leaves the preview; what failed stays for another try.
  for (const r of results.filter((x) => x.ok)) {
    for (const file of r.files) {
      if (git(['cat-file', '-e', `HEAD:${file}`], pv.dir) !== null)
        git(['checkout', '-q', 'HEAD', '--', file], pv.dir);
      else rmSync(join(pv.dir, file), { force: true });
    }
  }
  for (const r of results) {
    say([
      r.ok
        ? `preview: kept ${r.files.join(', ')} on ${r.task}${r.folded ? ', folded into its commits' : ' as fixup! commits (the fold-in conflicted)'}`
        : `preview: ${r.task}: ${r.error}`,
    ]);
  }
  if (results.some((r) => !r.ok)) {
    applyOverlay(pv);
    return 1;
  }
  // Show the branches as they now are: the same code, so a running stack sees no change.
  applyOverlay(pv);
  const target = targetOf(cfg, state.kind, state.id);
  const moved = target.error ? target : switchPreview(pv, target);
  // A refused switch leaves the overlay on, as it found it.
  return moved.error ? refuse(moved.error) : 0;
};

const drop = (pv) => {
  const off = removeOverlay(pv);
  if (off.error) return refuse(off.error);
  const edits = editsIn(pv);
  for (const e of edits) {
    if (e.code === '??') rmSync(join(pv.dir, e.path), { force: true });
    else git(['checkout', '-q', 'HEAD', '--', e.path], pv.dir);
  }
  applyOverlay(pv);
  say([
    edits.length
      ? `preview: dropped ${edits.map((e) => e.path).join(', ')}`
      : 'preview: no edits to drop',
  ]);
  return 0;
};

export const run = (cfg, args = []) => {
  const pv = previewConfig(cfg);
  if (!pv)
    return refuse(
      'no preview set — add "preview": { "dir": "../<project>-preview", "start": "…" } to .claude/crew.local.json',
    );
  const [verb, arg] = args;
  if (!verb) return refuse(USAGE);
  if (verb === 'init') return init(cfg, pv);
  if (verb === 'main' || verb === cfg.baseBranch) return show(cfg, pv, 'base');
  if (verb === 'group') return arg ? show(cfg, pv, 'group', arg) : refuse(USAGE);
  if (verb === 'keep') {
    const at = args.indexOf('--to');
    return keep(cfg, pv, at === -1 ? null : args[at + 1]?.padStart(3, '0'));
  }
  if (verb === 'drop') return drop(pv);
  if (verb === 'status') {
    const s = status(cfg, pv);
    if (args.includes('--json')) {
      console.log(JSON.stringify(s));
      return s.error ? 1 : 0;
    }
    if (s.error) return refuse(s.error);
    say([
      `preview: ${s.state?.label ?? 'unknown'} in ${s.dir}`,
      s.edits?.length
        ? `  edited: ${s.edits.map((e) => e.path).join(', ')} — keep or drop`
        : '  no edits',
    ]);
    return 0;
  }
  if (/^\d+$/.test(verb)) return show(cfg, pv, 'task', verb);
  return refuse(USAGE);
};
