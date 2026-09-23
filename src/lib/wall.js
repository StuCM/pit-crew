// What `crew serve` shows, read from the files the loop already keeps. The
// task files stay the source of truth; the page adds only what a person does
// on it — answers, marks, decisions on the scout's gaps — in one state file.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { declaredFiles, readTasks } from './task.js';

export const WORK_DIR = join('.claude', 'crew', 'work');
// The one-file shape from before a repository could hold several pieces of
// work at once. Still read, as the piece of work called `current`.
export const WORK_FILE = join('.claude', 'crew', 'work.json');
export const STATE_FILE = join('.claude', 'crew', 'wall.json');
const MAX_BYTES = 512 * 1024;
const HIDDEN = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build']);

/**
 * A repo-relative path, resolved and checked to stay inside the repository —
 * symlinks included — or null. Every path the page asks for goes through
 * this, because the page is a browser tab and a browser tab is not trusted.
 */
export const safePath = (root, rel) => {
  if (typeof rel !== 'string' || rel.includes('\0')) return null;
  const top = realpathSync(root);
  const full = resolve(top, rel.replace(/^\/+/, ''));
  if (full !== top && !full.startsWith(top + sep)) return null;
  // A path that does not exist yet can still sit under a symlink that leads
  // out, so check the nearest part of it that does exist.
  let probe = full;
  while (!existsSync(probe)) probe = dirname(probe);
  const real = realpathSync(probe);
  if (real !== top && !real.startsWith(top + sep)) return null;
  return probe === full ? real : full;
};

/** `## Heading` → body, for the sections of a task file. */
export const sections = (text) => {
  const out = {};
  let name = null;
  for (const line of text.replace(/^---[\s\S]*?\n---\n?/, '').split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      name = heading[1];
      out[name] = [];
    } else if (name) out[name].push(line);
  }
  for (const key of Object.keys(out)) {
    out[key] = out[key]
      .join('\n')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();
  }
  return out;
};

/** The items of a markdown list, or the body as one item if it is prose. */
export const items = (body = '') => {
  // A bare `-` is the template's empty list item, not content.
  const lines = body.split('\n').filter((line) => !['', '-'].includes(line.trim()));
  const listed = lines
    .map((line) => /^\s*(?:[-*]|\d+\.)\s+(?:\[[ x]\]\s+)?(.*)$/.exec(line)?.[1])
    .filter(Boolean);
  if (listed.length) return listed;
  return lines.length ? [lines.join('\n').trim()] : [];
};

// `path/to/file.py` or `path/to/file.py:78`, as a spec writes them. Only paths
// that exist are kept, so prose that happens to contain a slash is not a link.
const MENTION = /(?<![\w/.-])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+)(?::(\d+))?/g;

export const mentions = (root, text) => {
  const found = new Map();
  for (const [, path, line] of text.matchAll(MENTION)) {
    const key = `${path}:${line ?? ''}`;
    if (found.has(key)) continue;
    const full = safePath(root, path);
    if (full && existsSync(full)) found.set(key, { path, line: line ? Number(line) : null });
  }
  return [...found.values()];
};

/** One task as the page draws it. */
export const taskView = (root, task) => {
  const part = sections(task.text);
  const files = declaredFiles(task).map((path) => {
    const full = safePath(root, path);
    return { path, exists: Boolean(full && existsSync(full)) };
  });
  const declared = new Set(files.map((f) => f.path));
  return {
    id: task.id,
    file: relative(root, task.path),
    slug: task.meta.slug ?? '',
    title: task.title,
    status: task.meta.status ?? 'draft',
    model: task.meta.model ?? null,
    env: task.meta.env ?? null,
    branch: task.meta.branch ?? null,
    part: task.meta.part ?? null,
    work: task.meta.work ?? null,
    files,
    goal: part.Goal ?? '',
    background: part.Background ?? '',
    assumed: items(part.Assumed),
    approach: items(part.Approach),
    outOfScope: items(part['Out of scope']),
    done: items(part['Definition of done']),
    scoutRequests: items(part['Scout requests']),
    reviewRounds: part['Review rounds'] ?? '',
    mentions: mentions(root, task.text).filter((m) => !declared.has(m.path) || m.line),
  };
};

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};

export const emptyState = () => ({ answers: {}, gaps: {}, marks: [], requests: {} });

export const readState = (root) => ({ ...emptyState(), ...readJson(join(root, STATE_FILE), {}) });

export const writeState = (root, state) => {
  const path = join(root, STATE_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
};

/**
 * Every piece of work recorded in this repository, newest first. Each one is
 * `.claude/crew/work/<slug>.json`, and a task joins it with `work: <slug>`.
 */
export const readWorks = (root) => {
  const found = [];
  const dir = join(root, WORK_DIR);
  let names = [];
  try {
    names = readdirSync(dir).filter((name) => /^[\w-]+\.json$/.test(name));
  } catch {}
  for (const name of names) {
    const work = readJson(join(dir, name), null);
    if (work)
      found.push({ ...work, slug: name.slice(0, -5), updated: statSync(join(dir, name)).mtimeMs });
  }
  const legacy = join(root, WORK_FILE);
  const old = readJson(legacy, null);
  if (old) found.push({ ...old, slug: 'current', updated: statSync(legacy).mtimeMs });
  return found.sort((a, b) => b.updated - a.updated);
};

/** Everything the page needs in one read. */
export const snapshot = (cfg) => ({
  project: cfg.project,
  models: cfg.models,
  works: readWorks(cfg.root),
  tasks: readTasks(join(cfg.root, cfg.tasksDir)).map((task) => taskView(cfg.root, task)),
  state: readState(cfg.root),
});

/** A file's lines, for the viewer. Refuses directories, binaries and giants. */
export const readSource = (root, rel) => {
  const full = safePath(root, rel);
  if (!full || !existsSync(full)) return { error: 'not found' };
  const info = statSync(full);
  if (info.isDirectory()) return { error: 'a directory' };
  const buffer = readFileSync(full).subarray(0, MAX_BYTES);
  if (buffer.includes(0)) return { error: 'a binary file' };
  return {
    path: relative(realpathSync(root), full),
    lines: buffer.toString('utf8').split(/\r?\n/),
    truncated: info.size > MAX_BYTES,
  };
};

/** One directory level, folders first, without the noise nobody browses. */
export const listDir = (root, rel = '') => {
  const full = safePath(root, rel || '.');
  if (!full || !existsSync(full) || !statSync(full).isDirectory()) return { error: 'not found' };
  const top = realpathSync(root);
  const entries = readdirSync(full, { withFileTypes: true })
    .filter((entry) => !HIDDEN.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: relative(top, join(full, entry.name)),
      dir: entry.isDirectory(),
    }))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return { path: relative(top, full), entries };
};

const SCOUT_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git grep:*)',
  'Bash(npx crew graph:*)',
];

// The fixer edits, commits and rewrites its own branch. Nothing else: no
// push, no other git verbs, no shell beyond the gate.
const FIXER_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Edit',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(git rebase:*)',
  'Bash(npx crew gate:*)',
];

/**
 * One of crew's agents as a `claude -p` invocation. Its own agent file is the
 * prompt, so the page talks to exactly the agent the loop spawns, with only
 * the tools listed here, whatever the caller's settings allow. The message
 * goes in on stdin, where nothing in it can be read as a flag.
 */
export const agentArgs = (agentFile, name, tools, sessionId) => {
  const text = readFileSync(agentFile, 'utf8');
  const meta = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
  const field = (key) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(meta)?.[1]?.trim();
  const prompt = text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  const agents = { [name]: { description: field('description') ?? name, prompt } };
  const args = [
    '-p',
    '--output-format',
    'json',
    '--agents',
    JSON.stringify(agents),
    '--agent',
    name,
    '--model',
    field('model') ?? 'sonnet',
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    ...tools,
  ];
  if (!tools.includes('Edit')) args.push('--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
  if (sessionId) args.push('--resume', sessionId);
  return args;
};

export const scoutArgs = (agentFile, sessionId) =>
  agentArgs(agentFile, 'crew-scout', SCOUT_TOOLS, sessionId);

export const fixerArgs = (agentFile) => agentArgs(agentFile, 'crew-fixer', FIXER_TOOLS);
