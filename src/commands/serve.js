// `crew serve` — the pit wall: one local page for everything in flight on
// this machine, across projects. It reads the task files and the scout's
// findings, shows what each worker has changed, opens files in your editor,
// and runs crew's agents on request.
//
// One server holds every project. A second `crew serve` adds its repository
// to the registry and points you at the server already running.
//
// It listens on 127.0.0.1 only, answers only to a localhost Host header, and
// every write needs the token baked into the page it served. A browser tab on
// some other site can reach localhost; none of those three let it act. The
// page names a project by key, never by path, so it can only reach
// repositories that `crew serve` itself registered.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { basename, join, resolve } from 'node:path';
import { run as logEvent } from './log.js';
import { loadConfig } from '../lib/config.js';
import { git } from '../lib/git.js';
import { readTasks, setField } from '../lib/task.js';
import { projects, register } from '../lib/registry.js';
import { commitChanges, fileSides, suggestionTarget, taskChanges } from '../lib/changes.js';
import {
  fixerArgs,
  listDir,
  readSource,
  readState,
  safePath,
  scoutArgs,
  snapshot,
  writeState,
} from '../lib/wall.js';

const PAGE = fileURLToPath(new URL('../web/wall.html', import.meta.url));
const SCOUT = fileURLToPath(new URL('../../agents/crew-scout.md', import.meta.url));
const FIXER = fileURLToPath(new URL('../../agents/crew-fixer.md', import.meta.url));
const CLAUDE = process.env.CREW_CLAUDE || 'claude';
const EDITOR = process.env.CREW_EDITOR || 'code';
const MAX_BODY = 64 * 1024;
const AGENT_TIMEOUT = 15 * 60 * 1000;
const WAITS = new Set(['draft', 'blocked']);

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((done, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        fail(new Error('too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        fail(new Error('not JSON'));
      }
    });
  });

const findTask = (cfg, id) =>
  readTasks(join(cfg.root, cfg.tasksDir)).find((task) => task.id === String(id));

const update = (cfg, change) => {
  const state = readState(cfg.root);
  change(state);
  writeState(cfg.root, state);
  return state;
};

const text = (value, max = 4000) => (typeof value === 'string' ? value.slice(0, max) : '');
const now = () => new Date().toISOString();
const workKey = (value) => (/^[\w-]{1,80}$/.test(value ?? '') ? value : 'current');

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

export const askScout = (cfg, message, session, bin = CLAUDE) =>
  runAgent(cfg.root, scoutArgs(SCOUT, session), message, { bin }).then((answer) =>
    answer.error ? answer : { ...answer, session: answer.session ?? session ?? null },
  );

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

const launch = (args) =>
  new Promise((done) => {
    const child = spawn(EDITOR, args, { detached: true, stdio: 'ignore' });
    child.on('error', () =>
      done({
        error: `${EDITOR} is not on PATH. Set CREW_EDITOR, or run "Shell Command: Install 'code' command in PATH" in VS Code.`,
      }),
    );
    child.on('spawn', () => {
      child.unref();
      done({ ok: true });
    });
  });

const openInEditor = (cfg, path, line) => {
  const full = safePath(cfg.root, path);
  if (!full || !existsSync(full)) return { error: 'no such file' };
  return launch(['-g', line ? `${full}:${Number(line)}` : full]);
};

// The editor's own diff view, side by side: the base version on the left
// from git, and on the right the live file in the worktree, so it keeps up
// while the worker is still writing.
const diffInEditor = (cfg, task, path) => {
  const changes = taskChanges(cfg, task);
  if (changes.error) return changes;
  const sides = fileSides(cfg, changes, path);
  if (!sides) return { error: 'that file is not in the diff' };
  const dir = mkdtempSync(join(tmpdir(), 'crew-diff-'));
  const left = join(dir, `base-${basename(path)}`);
  writeFileSync(left, sides.before);
  let right = sides.after;
  if (!sides.afterIsPath) {
    right = join(dir, `${task.id}-${basename(path)}`);
    writeFileSync(right, sides.after);
  }
  return launch(['--diff', left, right]);
};

const runCommand = (cfg, task) => {
  const dir = `${cfg.worktreeDir}/${cfg.project}-${task.id}`;
  const brief = `Use the crew-worker skill for task ${join(cfg.tasksDir, task.file)}. You are in a worktree; the spec is the brief.`;
  return `cd ${dir} && claude --model ${task.meta.model || cfg.models.default} "${brief}"`;
};

/**
 * Hand the open suggestions on a task to the fixer, in the task's worktree.
 * Refused while the worker is still building: two agents rewriting one
 * branch at once is how a clean history becomes a lost one.
 */
const applySuggestions = (cfg, task, bin) => {
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
  runAgent(changes.worktree, fixerArgs(FIXER), brief, { bin, env }).then((answer) => {
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
  });
  return { ok: true, started: open.length };
};

const routes = {
  'GET /api/state': (cfg) => snapshot(cfg),
  'GET /api/file': (cfg, _, url) => readSource(cfg.root, url.searchParams.get('path') ?? ''),
  'GET /api/dir': (cfg, _, url) => listDir(cfg.root, url.searchParams.get('path') ?? ''),
  'GET /api/changes': (cfg, _, url) => {
    const task = findTask(cfg, url.searchParams.get('id'));
    return task ? taskChanges(cfg, task) : { error: 'no such task' };
  },
  'GET /api/commit': (cfg, _, url) => commitChanges(cfg, url.searchParams.get('sha')),

  'POST /api/diff-editor': (cfg, body) => {
    const task = findTask(cfg, body.id);
    return task ? diffInEditor(cfg, task, text(body.path, 1000)) : { error: 'no such task' };
  },
  'POST /api/open-worktree': (cfg, body) => {
    const task = findTask(cfg, body.id);
    if (!task) return { error: 'no such task' };
    const changes = taskChanges(cfg, task);
    return changes.worktree
      ? launch([changes.worktree])
      : { error: 'no worktree for this task on this machine' };
  },
  'POST /api/open': (cfg, body) => openInEditor(cfg, text(body.path, 1000), body.line),

  'POST /api/answer': (cfg, body) =>
    update(cfg, (s) => {
      s.answers[text(body.id, 200)] = { text: text(body.text), at: now() };
    }),
  'POST /api/gap': (cfg, body) =>
    update(cfg, (s) => {
      const choice = body.choice === 'follow' ? 'follow' : 'accept';
      s.gaps[text(body.id, 200)] = { choice, at: now() };
    }),
  'POST /api/mark': (cfg, body) =>
    update(cfg, (s) => {
      s.marks.push({
        id: `m${Date.now().toString(36)}`,
        task: text(body.task, 20),
        section: text(body.section, 60),
        quote: text(body.quote, 400),
        kind: ['wrong', 'change', 'question'].includes(body.kind) ? body.kind : 'question',
        note: text(body.note),
        status: 'open',
        at: now(),
      });
    }),

  // A suggested edit to a line in a task's diff, tied to the commit it
  // belongs in. The fixer applies them; nothing changes until you ask.
  'POST /api/suggest': (cfg, body) => {
    const task = findTask(cfg, body.task);
    if (!task) return { error: 'no such task' };
    const changes = taskChanges(cfg, task);
    if (changes.error) return changes;
    const path = text(body.path, 1000);
    if (!changes.files.some((f) => f.path === path))
      return { error: 'that file is not in the diff' };
    const line = Number(body.line) || null;
    const side = body.side === 'old' ? 'old' : 'new';
    const target = suggestionTarget(cfg, changes, path, line, side);
    return update(cfg, (s) => {
      s.suggestions ??= [];
      s.suggestions.push({
        id: `s${Date.now().toString(36)}`,
        task: task.id,
        path,
        line,
        side,
        quote: text(body.quote, 400),
        note: text(body.note),
        replacement: text(body.replacement, 4000),
        target,
        status: 'open',
        at: now(),
      });
    });
  },
  'POST /api/suggestion/delete': (cfg, body) =>
    update(cfg, (s) => {
      s.suggestions = (s.suggestions ?? []).filter(
        (item) => item.id !== body.id || item.status === 'applying',
      );
    }),
  'POST /api/apply': (cfg, body, _, opts) => {
    const task = findTask(cfg, body.id);
    return task ? applySuggestions(cfg, task, opts.claude) : { error: 'no such task' };
  },

  // The page is where the person is, so approving here is the same human
  // gate as approving in the conversation — and it logs the same event.
  'POST /api/approve': (cfg, body) => {
    const task = findTask(cfg, body.id);
    if (!task) return { error: 'no such task' };
    if (task.meta.status !== 'draft') return { error: `task is ${task.meta.status}, not draft` };
    setField(task.path, 'status', 'approved');
    logEvent(cfg, [task.path, 'spec']);
    return { ok: true };
  },
  'POST /api/run': (cfg, body) => {
    const task = findTask(cfg, body.id);
    if (!task) return { error: 'no such task' };
    if (task.meta.status !== 'approved')
      return { error: `task is ${task.meta.status}, not approved` };
    update(cfg, (s) => {
      s.requests[task.id] = { action: 'run', at: now() };
    });
    return { ok: true, command: runCommand(cfg, task) };
  },

  // One conversation with the scout per piece of work, so two things in
  // flight in one repository do not talk over each other.
  'POST /api/scout': async (cfg, body, _, opts) => {
    const message = text(body.message, 8000).trim();
    if (!message) return { error: 'nothing to ask' };
    const work = workKey(body.work);
    const session = readState(cfg.root).scout?.[work]?.session ?? null;
    const answer = await askScout(cfg, message, session, opts.claude);
    update(cfg, (s) => {
      if (!s.scout || Array.isArray(s.scout)) s.scout = {};
      s.scout[work] ??= { session: null, turns: [] };
      s.scout[work].turns.push({ role: 'you', text: message, at: now() });
      s.scout[work].turns.push({
        role: 'scout',
        text: answer.text ?? answer.error,
        error: Boolean(answer.error),
        at: now(),
      });
      if (answer.session) s.scout[work].session = answer.session;
    });
    return answer;
  },
  'POST /api/scout/new': (cfg, body) =>
    update(cfg, (s) => {
      if (!s.scout || Array.isArray(s.scout)) s.scout = {};
      s.scout[workKey(body.work)] = { session: null, turns: [] };
    }),
};

/** Each project, with how many of its tasks are waiting on a person. */
const projectList = () =>
  projects().map((p) => {
    let waiting = 0;
    try {
      const cfg = loadConfig(p.root);
      for (const task of readTasks(join(p.root, cfg.tasksDir))) {
        const status = task.meta.status ?? '';
        if (WAITS.has(status) || status.startsWith('pending-')) waiting++;
      }
    } catch {}
    return { key: p.key, name: p.name, waiting };
  });

/** The server itself, so a test can drive it on a free port. */
export const createWall = (
  home,
  { token = randomBytes(16).toString('hex'), registry, claude = CLAUDE } = {},
) => {
  const server = createServer(async (req, res) => {
    // A page on another site can point at localhost by a name it controls;
    // the Host header is what that rebinding cannot fake.
    const { port } = server.address();
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) {
      return send(res, 403, { error: 'wrong host' });
    }
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const page = readFileSync(PAGE, 'utf8')
        .replace('__CREW_TOKEN__', token)
        .replace('__CREW_HOME__', home ?? '');
      return send(res, 200, page, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/ping')
      return send(res, 200, { crew: 'pit-wall' });
    if (req.method === 'GET' && url.pathname === '/api/projects') {
      return send(res, 200, registry ? registry() : projectList());
    }

    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'not found' });
    if (req.method === 'POST' && req.headers['x-crew-token'] !== token) {
      return send(res, 403, { error: 'missing token' });
    }

    const key = url.searchParams.get('p') || home;
    const project = (registry ? registry() : projects()).find((p) => p.key === key);
    if (!project) return send(res, 404, { error: `no project "${key}" — run crew serve in it` });

    try {
      const cfg = project.cfg ?? loadConfig(project.root);
      const body = req.method === 'POST' ? await readBody(req) : null;
      const result = await handler(cfg, body, url, { claude });
      send(res, result?.error ? 400 : 200, result ?? {});
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  });
  return { server, token };
};

const already = async (port) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ping`, {
      signal: AbortSignal.timeout(800),
    });
    return (await res.json()).crew === 'pit-wall';
  } catch {
    return false;
  }
};

export const run = async (cfg, args) => {
  const given = args.find((arg) => arg.startsWith('--port='));
  const port = Number(given?.slice('--port='.length)) || 4747;
  const key = register(cfg.root, cfg.project);

  if (await already(port)) {
    console.log(`crew serve: already running — ${cfg.project} is on it now.`);
    console.log(`http://localhost:${port}/?p=${key}`);
    return 0;
  }

  const { server } = createWall(key);
  server.on('error', (error) => {
    console.error(
      `crew serve: ${error.code === 'EADDRINUSE' ? `port ${port} is taken by something else — pass --port=N` : error.message}`,
    );
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`crew serve: http://localhost:${port}/?p=${key}`);
    console.log('Every project you run crew serve in joins this one page. Ctrl-C to stop.');
    // An API key in the environment outranks a subscription login for
    // `claude -p`, so every agent run from the page would bill the API.
    if (process.env.ANTHROPIC_API_KEY) {
      console.log(
        'note: ANTHROPIC_API_KEY is set, so agents run from the page bill the API, not your subscription.',
      );
    }
  });
  return new Promise(() => {});
};
