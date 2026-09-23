// `crew serve` — the pit wall: one local page for a piece of work. It reads
// the task files and the scout's findings, opens files in your editor, and
// lets you talk to the scout directly.
//
// It listens on 127.0.0.1 only, answers only to a localhost Host header, and
// every write needs the token baked into the page it served. A browser tab on
// some other site can reach localhost; none of those three let it act.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { run as logEvent } from './log.js';
import { readTasks, setField } from '../lib/task.js';
import { basename, join } from 'node:path';
import { commitChanges, fileSides, taskChanges } from '../lib/changes.js';
import {
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
const CLAUDE = process.env.CREW_CLAUDE || 'claude';
const EDITOR = process.env.CREW_EDITOR || 'code';
const MAX_BODY = 64 * 1024;
const SCOUT_TIMEOUT = 10 * 60 * 1000;

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

/** Run the scout once; resolves `{ text, session }` or `{ error }`. */
export const askScout = (cfg, message, session, bin = CLAUDE) =>
  new Promise((done) => {
    const child = spawn(bin, scoutArgs(SCOUT, session), {
      cwd: cfg.root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), SCOUT_TIMEOUT);
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', () => {
      clearTimeout(timer);
      done({ error: `${bin} is not on PATH, so the scout cannot run from here.` });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(out);
        if (result.is_error) return done({ error: result.result || 'the scout failed' });
        done({ text: result.result ?? '', session: result.session_id ?? session ?? null });
      } catch {
        done({ error: (err || out || 'the scout returned nothing').trim().slice(0, 600) });
      }
    });
    child.stdin.end(message);
  });

const openInEditor = (cfg, path, line) =>
  new Promise((done) => {
    const full = safePath(cfg.root, path);
    if (!full || !existsSync(full)) return done({ error: 'no such file' });
    const target = line ? `${full}:${Number(line)}` : full;
    const child = spawn(EDITOR, ['-g', target], { detached: true, stdio: 'ignore' });
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

const launch = (args) =>
  new Promise((done) => {
    const child = spawn(EDITOR, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => done({ error: `${EDITOR} is not on PATH. Set CREW_EDITOR.` }));
    child.on('spawn', () => {
      child.unref();
      done({ ok: true });
    });
  });

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

const routes = (cfg) => ({
  'GET /api/state': () => snapshot(cfg),
  'GET /api/file': (_, url) => readSource(cfg.root, url.searchParams.get('path') ?? ''),
  'GET /api/dir': (_, url) => listDir(cfg.root, url.searchParams.get('path') ?? ''),
  'GET /api/changes': (_, url) => {
    const task = findTask(cfg, url.searchParams.get('id'));
    return task ? taskChanges(cfg, task) : { error: 'no such task' };
  },
  'GET /api/commit': (_, url) => commitChanges(cfg, url.searchParams.get('sha')),
  'POST /api/diff-editor': (body) => {
    const task = findTask(cfg, body.id);
    return task ? diffInEditor(cfg, task, text(body.path, 1000)) : { error: 'no such task' };
  },
  'POST /api/open-worktree': (body) => {
    const task = findTask(cfg, body.id);
    if (!task) return { error: 'no such task' };
    const changes = taskChanges(cfg, task);
    return changes.worktree
      ? launch([changes.worktree])
      : { error: 'no worktree for this task on this machine' };
  },

  'POST /api/answer': (body) =>
    update(cfg, (s) => {
      s.answers[text(body.id, 100)] = { text: text(body.text), at: new Date().toISOString() };
    }),
  'POST /api/gap': (body) =>
    update(cfg, (s) => {
      const choice = body.choice === 'follow' ? 'follow' : 'accept';
      s.gaps[text(body.id, 100)] = { choice, at: new Date().toISOString() };
    }),
  'POST /api/mark': (body) =>
    update(cfg, (s) => {
      s.marks.push({
        id: `m${Date.now().toString(36)}`,
        task: text(body.task, 20),
        section: text(body.section, 60),
        quote: text(body.quote, 400),
        kind: ['wrong', 'change', 'question'].includes(body.kind) ? body.kind : 'question',
        note: text(body.note),
        status: 'open',
        at: new Date().toISOString(),
      });
    }),

  // The page is where the person is, so approving here is the same human
  // gate as approving in the conversation — and it logs the same event.
  'POST /api/approve': (body) => {
    const task = findTask(cfg, body.id);
    if (!task) return { error: 'no such task' };
    if (task.meta.status !== 'draft') return { error: `task is ${task.meta.status}, not draft` };
    setField(task.path, 'status', 'approved');
    logEvent(cfg, [task.path, 'spec']);
    return { ok: true };
  },
  'POST /api/run': (body) => {
    const task = findTask(cfg, body.id);
    if (!task) return { error: 'no such task' };
    if (task.meta.status !== 'approved')
      return { error: `task is ${task.meta.status}, not approved` };
    const command = runCommand(cfg, task);
    update(cfg, (s) => {
      s.requests[task.id] = { action: 'run', at: new Date().toISOString() };
    });
    return { ok: true, command };
  },
  'POST /api/open': (body) => openInEditor(cfg, text(body.path, 1000), body.line),
  'POST /api/scout': async (body) => {
    const message = text(body.message, 8000).trim();
    if (!message) return { error: 'nothing to ask' };
    const session = /^[\w-]{8,80}$/.test(body.session ?? '') ? body.session : null;
    const answer = await askScout(cfg, message, session);
    update(cfg, (s) => {
      s.scout ??= [];
      s.scout.push({ role: 'you', text: message, at: new Date().toISOString() });
      s.scout.push({
        role: 'scout',
        text: answer.text ?? answer.error,
        error: Boolean(answer.error),
        at: new Date().toISOString(),
      });
      if (answer.session) s.scoutSession = answer.session;
    });
    return answer;
  },
  'POST /api/scout/new': () =>
    update(cfg, (s) => {
      s.scout = [];
      s.scoutSession = null;
    }),
});

/** The server itself, so a test can drive it on a free port. */
export const createWall = (cfg, { token = randomBytes(16).toString('hex') } = {}) => {
  const table = routes(cfg);

  const server = createServer(async (req, res) => {
    // A page on another site can point at localhost by a name it controls;
    // the Host header is what that rebinding cannot fake.
    const { port } = server.address();
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) {
      return send(res, 403, { error: 'wrong host' });
    }
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const page = readFileSync(PAGE, 'utf8').replace('__CREW_TOKEN__', token);
      return send(res, 200, page, 'text/html; charset=utf-8');
    }

    const handler = table[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'not found' });
    if (req.method === 'POST' && req.headers['x-crew-token'] !== token) {
      return send(res, 403, { error: 'missing token' });
    }

    try {
      const body = req.method === 'POST' ? await readBody(req) : null;
      const result = await handler(body, url);
      send(res, result?.error ? 400 : 200, result ?? {});
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  });
  return { server, token };
};

export const run = (cfg, args) => {
  const given = args.find((arg) => arg.startsWith('--port='));
  const port = Number(given?.slice('--port='.length)) || 4747;
  const { server } = createWall(cfg);
  server.on('error', (error) => {
    console.error(
      `crew serve: ${error.code === 'EADDRINUSE' ? `port ${port} is taken — pass --port=N` : error.message}`,
    );
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`crew serve: http://localhost:${port}`);
    console.log('Open it in the Claude desktop browser pane. Ctrl-C to stop.');
    // An API key in the environment outranks a subscription login for
    // `claude -p`, so every scout chat would be billed to the API.
    if (process.env.ANTHROPIC_API_KEY) {
      console.log(
        'note: ANTHROPIC_API_KEY is set, so scout chats bill the API, not your subscription.',
      );
    }
  });
  return new Promise(() => {});
};
