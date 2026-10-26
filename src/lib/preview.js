// One running copy of the app that shows whichever task, group or base the
// person points it at, so trying a change never means switching branches in
// the checkout they work in, or running a stack per worktree.
//
// The preview is a detached worktree of the main repository. An overlay (a
// folder of untracked files, and a patch to tracked ones) is laid over every
// switch: it is how a project runs on a stack its committed code is not set
// up for, without committing that set-up.

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { git, gitLines } from './git.js';

export const PATCH = 'patch.diff';
const STATE = 'crew-preview.json';
// Merges in a detached preview are throwaway; git still wants a name on them.
const WHO = ['-c', 'user.name=crew preview', '-c', 'user.email=crew@localhost'];

const asList = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

/** The preview's settings with paths resolved, or null when the project has none. */
export const previewConfig = (cfg) => {
  const p = cfg.preview;
  if (!p?.dir) return null;
  return {
    dir: resolve(cfg.root, p.dir),
    start: p.start ?? null,
    overlay: p.overlay ? resolve(cfg.root, p.overlay) : null,
    afterSwitch: asList(p.afterSwitch),
  };
};

/** `**`, `*`, `?` and `{a,b}`, as a project writes them in `afterSwitch[].when`. */
export const globToRegex = (glob) => {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      out += `(?:${glob
        .slice(i + 1, end)
        .split(',')
        .map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&'))
        .join('|')})`;
      i = end;
    } else out += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
};

const statePath = (pv) => {
  const at = git(['rev-parse', '--git-path', STATE], pv.dir)?.trim();
  return at ? resolve(pv.dir, at) : null;
};

export const readPreview = (pv) => {
  try {
    return JSON.parse(readFileSync(statePath(pv), 'utf8'));
  } catch {
    return null;
  }
};

export const writePreview = (pv, state) =>
  writeFileSync(statePath(pv), `${JSON.stringify(state, null, 2)}\n`);

/** The overlay's untracked files, by path relative to the overlay and the preview alike. */
export const overlayFiles = (pv) => {
  if (!pv.overlay || !existsSync(pv.overlay)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (relative(pv.overlay, full) !== PATCH) out.push(relative(pv.overlay, full));
    }
  };
  walk(pv.overlay);
  return out.sort();
};

const patchFile = (pv) => (pv.overlay ? join(pv.overlay, PATCH) : null);
const hasPatch = (pv) => Boolean(patchFile(pv) && existsSync(patchFile(pv)));

/** Lay the overlay over what is checked out. */
export const applyOverlay = (pv) => {
  for (const rel of overlayFiles(pv)) {
    mkdirSync(dirname(join(pv.dir, rel)), { recursive: true });
    copyFileSync(join(pv.overlay, rel), join(pv.dir, rel));
  }
  if (hasPatch(pv) && git(['apply', '--whitespace=nowarn', patchFile(pv)], pv.dir) === null) {
    return { error: `the overlay's ${PATCH} does not apply to this code` };
  }
  return { ok: true };
};

/**
 * Take the overlay back off, leaving only what the checkout and the person's
 * own edits hold. Refuses, changing nothing, when the patch no longer
 * reverses: the person edited the lines it changes.
 */
export const removeOverlay = (pv) => {
  if (hasPatch(pv) && git(['apply', '-R', '--check', patchFile(pv)], pv.dir) === null) {
    return { error: `edits in the preview touch the lines the overlay's ${PATCH} changes` };
  }
  if (hasPatch(pv)) git(['apply', '-R', patchFile(pv)], pv.dir);
  for (const rel of overlayFiles(pv)) rmSync(join(pv.dir, rel), { force: true });
  return { ok: true };
};

/** The person's own edits in the preview, the overlay already off: tracked changes and new files. */
export const editsIn = (pv) =>
  // Porcelain's leading space is part of the status, so the lines are not trimmed.
  (git(['status', '--porcelain', '--untracked-files=all'], pv.dir) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2), path: line.slice(3).replace(/^"|"$/g, '') }));

// One file's hunks in a unified diff, without the headers that vary (index lines, modes).
const hunksOf = (diff, path) => {
  const out = [];
  let mine = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) mine = line.endsWith(` b/${path}`);
    else if (mine && /^(@@|[ +-])/.test(line) && !/^(\+\+\+|---) /.test(line)) out.push(line);
  }
  return out.join('\n');
};

/**
 * The person's edits without touching a file: a running stack reloads on
 * every write, so this is what anything that polls calls. A file the overlay
 * patches counts as edited when its diff is no longer exactly the patch.
 */
export const peekEdits = (pv) => {
  const laid = new Set(overlayFiles(pv));
  const patch = hasPatch(pv) ? readFileSync(patchFile(pv), 'utf8') : '';
  const patched = new Set([...patch.matchAll(/^diff --git a\/.* b\/(.*)$/gm)].map((m) => m[1]));
  return editsIn(pv).filter(({ path }) => {
    if (laid.has(path)) return false;
    if (!patched.has(path)) return true;
    const now = git(['diff', '--no-color', 'HEAD', '--', path], pv.dir) ?? '';
    return hunksOf(now, path) !== hunksOf(patch, path);
  });
};

const MIGRATIONS = /(^|\/)migrations\/[^/]+\.(py|sql)$/;
const DEPENDENCIES =
  /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|uv\.lock|requirements[^/]*\.txt|Pipfile(\.lock)?)$/;

/** What moving from one commit to another means for a running stack. */
export const consequences = (pv, from, to) => {
  const changed = from && from !== to ? gitLines(['diff', '--name-only', from, to], pv.dir) : [];
  const run = pv.afterSwitch
    .filter(
      (step) => step.run && (!step.when || changed.some((p) => globToRegex(step.when).test(p))),
    )
    .map((step) => step.run);
  return {
    changed: changed.length,
    migrations: changed.filter((p) => MIGRATIONS.test(p)),
    dependencies: changed.filter((p) => DEPENDENCIES.test(p)),
    run,
  };
};

/** Run the project's after-switch commands in the preview, in order, stopping at the first failure. */
export const runSteps = (pv, steps) => {
  const out = [];
  for (const step of steps) {
    // The commands are the project's own, from its local config: a shell is what they are written for.
    const done = spawnSync(step, { cwd: pv.dir, shell: true, encoding: 'utf8', stdio: 'pipe' });
    out.push({
      run: step,
      ok: done.status === 0,
      tail: `${done.stdout}${done.stderr}`.trim().split('\n').slice(-5),
    });
    if (done.status !== 0) break;
  }
  return out;
};

/**
 * Move the preview onto one commit, or onto several branches merged over the
 * base, with the overlay taken off and laid back on around it. Nothing moves
 * while the person has edits of their own there.
 */
export const switchPreview = (pv, { base, branches, label, kind, id }) => {
  const off = removeOverlay(pv);
  if (off.error) return off;
  const edits = editsIn(pv);
  if (edits.length) {
    applyOverlay(pv);
    return {
      error: `the preview has edits of its own (${edits.map((e) => e.path).join(', ')}) — keep or drop them first`,
    };
  }
  const from = git(['rev-parse', 'HEAD'], pv.dir)?.trim() ?? null;
  const restore = () => {
    if (from) git(['checkout', '-q', '--detach', from], pv.dir);
    applyOverlay(pv);
  };
  if (git(['checkout', '-q', '--detach', base], pv.dir) === null) {
    restore();
    return { error: `could not check out ${base} in the preview` };
  }
  for (const branch of branches) {
    const merged = git(
      [...WHO, 'merge', '-q', '--no-ff', '--no-edit', '-m', `preview: ${branch}`, branch],
      pv.dir,
    );
    if (merged === null) {
      git(['merge', '--abort'], pv.dir);
      restore();
      return {
        error: `${branch} does not merge cleanly over the others — preview its tasks one at a time`,
      };
    }
  }
  const to = git(['rev-parse', 'HEAD'], pv.dir).trim();
  const laid = applyOverlay(pv);
  const state = { kind, id, label, base, branches, sha: to, at: new Date().toISOString() };
  writePreview(pv, state);
  return { ok: true, state, overlay: laid.error ?? null, ...consequences(pv, from, to) };
};
