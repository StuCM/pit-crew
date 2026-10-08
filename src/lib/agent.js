// Runs crew's agents headless through `claude -p`, for `crew fix`.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { taskChanges } from './changes.js';
import { git } from './git.js';
import { fixerArgs, readState, writeState } from './wall.js';

const FIXER = fileURLToPath(new URL('../../agents/crew-fixer.md', import.meta.url));
export const CLAUDE = process.env.CREW_CLAUDE || 'claude';
export const AGENT_TIMEOUT = 15 * 60 * 1000;

/** Run one of crew's agents headless; resolves `{ text, session }` or `{ error }`. */
export const runAgent = (cwd, args, message, { bin = CLAUDE, env = {} } = {}) =>
  new Promise((done) => {
    const child = spawn(bin, args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), AGENT_TIMEOUT);
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', () => {
      clearTimeout(timer);
      done({ error: `${bin} is not on PATH, so crew's agents cannot run from here.` });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(out);
        if (result.is_error) return done({ error: result.result || 'the agent failed' });
        done({ text: result.result ?? '', session: result.session_id ?? null });
      } catch {
        done({ error: (err || out || 'the agent returned nothing').trim().slice(0, 600) });
      }
    });
    child.stdin.end(message);
  });

const update = (cfg, change) => {
  const state = readState(cfg.root);
  change(state);
  writeState(cfg.root, state);
};

const now = () => new Date().toISOString();

/** The fixer's closing JSON block, or null if it did not leave one. */
export const fixerReport = (reply = '') => {
  const end = reply.lastIndexOf('}');
  for (
    let start = reply.lastIndexOf('{', end);
    start >= 0;
    start = reply.lastIndexOf('{', start - 1)
  ) {
    try {
      const parsed = JSON.parse(reply.slice(start, end + 1));
      if (Array.isArray(parsed?.results)) return parsed;
    } catch {}
  }
  return null;
};

/**
 * Hand the open suggestions on a task to the fixer, in the task's worktree.
 * Refused while the worker is still building: two agents rewriting one
 * branch at once is how a clean history becomes a lost one.
 */
export const applySuggestions = async (cfg, task, bin = CLAUDE) => {
  if (task.meta.status === 'building') {
    return { error: 'the worker is still building on this branch — apply once it stops' };
  }
  const changes = taskChanges(cfg, task);
  if (changes.error) return changes;
  if (!changes.worktree) return { error: 'no worktree for this task on this machine' };
  const open = (readState(cfg.root).suggestions ?? []).filter(
    (s) => s.task === task.id && s.status === 'open',
  );
  if (!open.length) return { error: 'no open suggestions on this task' };
  // A fixup commit stages whole files, so uncommitted edits in them would be
  // folded into a commit nobody reviewed.
  const commits = open.some((o) => o.target?.kind !== 'uncommitted');
  if (commits && changes.files.some((f) => f.uncommitted)) {
    return {
      error:
        'the worktree has uncommitted changes — commit or discard them before folding fixes into commits',
    };
  }

  update(cfg, (s) => {
    for (const item of s.suggestions)
      if (open.some((o) => o.id === item.id)) item.status = 'applying';
  });

  const brief = [
    `Task file: ${join(cfg.root, cfg.tasksDir, task.file)}`,
    `Base commit: ${changes.base}`,
    'Suggestions:',
    JSON.stringify(
      open.map(({ id, path, line, quote, note, replacement, target }) => ({
        id,
        path,
        line,
        quote,
        change: note,
        replaceWith: replacement || undefined,
        belongsIn:
          target.kind === 'fixup' ? `fixup ${target.sha} (${target.subject})` : target.kind,
      })),
      null,
      2,
    ),
  ].join('\n');

  // Accepting the todo list unchanged is what makes the autosquash rebase
  // run without an editor; the fixer cannot answer one.
  const env = { GIT_SEQUENCE_EDITOR: 'true', GIT_EDITOR: 'true' };
  const answer = await runAgent(changes.worktree, fixerArgs(FIXER), brief, { bin, env });
  // Whatever the fixer did, never leave the worktree stopped mid-rebase:
  // the worker, the gate and the person would all find it broken.
  const midway = ['rebase-merge', 'rebase-apply'].some((name) => {
    const at = git(['rev-parse', '--git-path', name], changes.worktree)?.trim();
    return at && existsSync(resolve(changes.worktree, at));
  });
  if (midway) git(['rebase', '--abort'], changes.worktree);
  const report = answer.error ? null : fixerReport(answer.text);
  update(cfg, (s) => {
    for (const item of s.suggestions) {
      if (!open.some((o) => o.id === item.id)) continue;
      const result = report?.results?.find((r) => r.id === item.id);
      item.status = result?.status === 'applied' ? 'applied' : 'failed';
      item.reply =
        result?.note ??
        (midway
          ? 'the fold-in conflicted and was undone; the fix is left as a fixup! commit'
          : null) ??
        answer.error ??
        'the fixer did not report on this one';
    }
    s.fixes ??= {};
    s.fixes[task.id] = {
      at: now(),
      rebased: !midway && (report?.rebased ?? false),
      gate: report?.gate ?? 'not run',
      text: (answer.text ?? answer.error ?? '').slice(0, 4000),
    };
  });
  return {
    ok: true,
    suggestions: readState(cfg.root).suggestions.filter((s) => open.some((o) => o.id === s.id)),
  };
};
