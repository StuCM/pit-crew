import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/commands/task.js';
import { frontmatter } from '../src/lib/task.js';
import { config, sandbox, writeTask } from './helpers.js';

const SPEC = (status = 'draft') => `---
id: 007
slug: thing
status: ${status}
model: sonnet
files:
  - src/a.ts
---

# A thing

## Goal
Holding OK opens a menu.

## Approach
1. First step
   continues here.
2. Second step

## Out of scope
- The rail
- The rail again

## Definition of done
- [ ] it opens
`;

const setup = (status) => {
  const root = sandbox();
  const path = writeTask(root, '007-thing.md', SPEC(status));
  return { root, path, cfg: config(root) };
};

// Runs the command, returning its exit code and what it printed on each stream.
const call = (cfg, args, input) => {
  const out = [];
  const err = [];
  const { log, error } = console;
  console.log = (line) => out.push(line);
  console.error = (line) => err.push(line);
  try {
    return { code: run(cfg, args, input), out, err };
  } finally {
    Object.assign(console, { log, error });
  }
};

const edit = (cfg, change) => call(cfg, ['007', 'edit'], JSON.stringify(change));
const body = (path) => readFileSync(path, 'utf8').split('\n---\n')[1];

test('set writes a known status and prints the task as the mod draws it', () => {
  const { cfg, path } = setup();
  const { code, out } = call(cfg, ['007', 'set', 'status', 'blocked']);
  assert.equal(code, 0);
  assert.equal(frontmatter(readFileSync(path, 'utf8')).status, 'blocked');
  assert.equal(JSON.parse(out.at(-1)).status, 'blocked');
});

test('set refuses an unknown status, a bad model and a value that would break the fence', () => {
  const { cfg, path } = setup();
  const before = readFileSync(path, 'utf8');
  const unknown = call(cfg, ['007', 'set', 'status', 'nearly-done']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.err[0], /unknown status "nearly-done"/);
  assert.equal(call(cfg, ['007', 'set', 'model', 'gpt-9']).code, 1);
  assert.equal(call(cfg, ['007', 'set', 'env', 'a\nstatus: done']).code, 1);
  assert.equal(readFileSync(path, 'utf8'), before);

  assert.equal(call(cfg, ['007', 'set', 'model', 'opus']).code, 0);
  assert.equal(frontmatter(readFileSync(path, 'utf8')).model, 'opus');
});

test('approve moves a draft to approved, logs the spec event and renders the board', () => {
  const { cfg, path, root } = setup();
  assert.equal(call(cfg, ['007', 'approve']).code, 0);
  assert.equal(frontmatter(readFileSync(path, 'utf8')).status, 'approved');
  const logged = readFileSync(join(root, cfg.log), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(
    logged.map((e) => [e.event, e.id, e.status]),
    [['spec', '007', 'approved']],
  );
  assert.match(
    readFileSync(join(root, cfg.tasksDir, 'BOARD.md'), 'utf8'),
    /\| 007 \| A thing \| `approved`/,
  );
});

test('approve refuses a task that is not a draft', () => {
  const { cfg, path } = setup('building');
  const { code, err } = call(cfg, ['007', 'approve']);
  assert.equal(code, 1);
  assert.match(err[0], /task is building, not draft/);
  assert.equal(frontmatter(readFileSync(path, 'utf8')).status, 'building');
});

const DESKTOP = { environments: { desktop: { reachableFromAgents: false, proves: ['ui'] } } };
const statusOf = (path) => frontmatter(readFileSync(path, 'utf8')).status;

test('signoff moves a pending task to done, logs the environment and renders the board', () => {
  const { cfg, path, root } = setup('pending-desktop');
  assert.equal(call({ ...cfg, ...DESKTOP }, ['007', 'signoff']).code, 0);
  assert.equal(statusOf(path), 'done');
  const logged = readFileSync(join(root, cfg.log), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(
    logged.map((e) => [e.event, e.status]),
    [['signoff desktop', 'done']],
  );
  assert.match(
    readFileSync(join(root, cfg.tasksDir, 'BOARD.md'), 'utf8'),
    /\| 007 \| A thing \| `done`/,
  );
});

test('signoff refuses a task that is not waiting on an environment', () => {
  for (const status of ['approved', 'building', 'done']) {
    const { cfg, path } = setup(status);
    const { code, err } = call({ ...cfg, ...DESKTOP }, ['007', 'signoff']);
    assert.equal(code, 1);
    assert.match(err[0], new RegExp(`task is ${status}, not waiting`));
    assert.equal(statusOf(path), status);
  }
});

test('sendback returns a blocked task to approved and logs it', () => {
  const { cfg, path, root } = setup('blocked');
  assert.equal(call(cfg, ['007', 'sendback']).code, 0);
  assert.equal(statusOf(path), 'approved');
  assert.match(readFileSync(join(root, cfg.log), 'utf8'), /"event":"sendback"/);
});

test('block records who stopped it and why, and sendback clears both', () => {
  const { cfg, path, root } = setup('building');
  const { code, out } = call(cfg, [
    '007',
    'block',
    'reviewer',
    'wraps',
    'post_save\ninstead of   replacing it',
  ]);
  assert.equal(code, 0);
  const meta = frontmatter(readFileSync(path, 'utf8'));
  assert.equal(meta.status, 'blocked');
  assert.equal(meta.blocked, 'wraps post_save instead of replacing it');
  assert.equal(meta['blocked-by'], 'reviewer');
  assert.equal(JSON.parse(out.at(-1)).blockedBy, 'reviewer');
  assert.match(readFileSync(join(root, cfg.log), 'utf8'), /"event":"block"/);

  assert.equal(call(cfg, ['007', 'sendback']).code, 0);
  const after = frontmatter(readFileSync(path, 'utf8'));
  assert.equal(after.status, 'approved');
  assert.equal(after.blocked, undefined);
  assert.equal(after['blocked-by'], undefined);
  assert.deepEqual(after.files, ['src/a.ts']);
});

test('block refuses without a reason or a known blocker', () => {
  const { cfg, path } = setup('building');
  assert.match(call(cfg, ['007', 'block', 'reviewer']).err[0], /say why/);
  assert.match(call(cfg, ['007', 'block', 'someone', 'why']).err[0], /who stopped it/);
  assert.equal(statusOf(path), 'building');
});

test('sendback refuses a task that is not blocked', () => {
  const { cfg, path } = setup('pending-desktop');
  const { code, err } = call({ ...cfg, ...DESKTOP }, ['007', 'sendback']);
  assert.equal(code, 1);
  assert.match(err[0], /not blocked/);
  assert.equal(statusOf(path), 'pending-desktop');
});

test('edit replaces one block, multi-line included', () => {
  const { cfg, path } = setup();
  const { code } = edit(cfg, {
    old: '1. First step\n   continues here.',
    new: '1. First, reworded',
  });
  assert.equal(code, 0);
  assert.match(body(path), /## Approach\n1\. First, reworded\n2\. Second step\n/);
});

test('edit with an empty new removes the line without leaving a blank one', () => {
  const { cfg, path } = setup();
  assert.equal(edit(cfg, { old: '2. Second step', new: '' }).code, 0);
  assert.match(body(path), /continues here\.\n\n## Out of scope/);
});

test('edit appends to a section in the style of its list', () => {
  const { cfg, path } = setup();
  assert.equal(edit(cfg, { section: 'Approach', append: 'Third step' }).code, 0);
  assert.equal(edit(cfg, { section: 'Out of scope', append: 'Exports' }).code, 0);
  assert.equal(edit(cfg, { section: 'Definition of done', append: 'it closes' }).code, 0);
  const text = body(path);
  assert.match(text, /2\. Second step\n3\. Third step\n\n## Out of scope/);
  assert.match(text, /- The rail again\n- Exports\n\n## Definition/);
  assert.match(text, /- \[ \] it opens\n- \[ \] it closes\n$/);
});

test('edit refuses missing, ambiguous and unknown-section changes, and leaves the file alone', () => {
  const { cfg, path } = setup();
  const before = readFileSync(path, 'utf8');
  assert.match(edit(cfg, { old: 'Not in it', new: 'x' }).err[0], /no longer in the spec/);
  assert.match(edit(cfg, { old: '- The rail', new: 'x' }).err[0], /appears 2 times/);
  assert.match(edit(cfg, { section: 'Nope', append: 'x' }).err[0], /no "## Nope" section/);
  assert.equal(call(cfg, ['007', 'edit'], 'not json').code, 1);
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('edit never touches the frontmatter, even when the old text is there', () => {
  const { cfg, path } = setup();
  const front = readFileSync(path, 'utf8').split('\n---\n')[0];
  assert.match(edit(cfg, { old: 'status: draft', new: 'status: done' }).err[0], /no longer/);
  assert.equal(edit(cfg, { old: 'Holding OK', new: 'Pressing OK' }).code, 0);
  assert.equal(readFileSync(path, 'utf8').split('\n---\n')[0], front);
  assert.match(body(path), /Pressing OK opens a menu/);
});
