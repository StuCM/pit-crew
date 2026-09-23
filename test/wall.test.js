import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { askScout, createWall } from '../src/commands/serve.js';
import {
  items,
  listDir,
  mentions,
  readSource,
  safePath,
  sections,
  snapshot,
} from '../src/lib/wall.js';
import { config, sandbox, writeTask } from './helpers.js';

const spec = `---
id: 024
slug: smm
status: draft
model: sonnet
files:
  - src/notify.py
  - test/test_notify.py
---

# SMM notifications read the list value

## Goal
The label shows.

## Assumed
<!-- a comment the page must not show -->
- the helper takes the old shape

## Approach
1. Change src/notify.py:3 to call src/labels.py:1.
2. Test it.

## Out of scope
-

## Definition of done
- [ ] the label shows
`;

const repo = () => {
  const root = sandbox();
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'notify.py'), 'a\nb\nc\n');
  writeFileSync(join(root, 'src', 'labels.py'), 'def label(): pass\n');
  writeTask(root, '024-smm.md', spec);
  return root;
};

test('a path outside the repository is refused, by .. or by symlink', () => {
  const root = repo();
  assert.equal(safePath(root, '../../etc/passwd'), null);
  assert.equal(safePath(root, '/etc/passwd')?.startsWith(root), true);
  symlinkSync(tmpdir(), join(root, 'out'));
  assert.equal(safePath(root, 'out/anything'), null);
  assert.equal(readSource(root, '../x').error, 'not found');
});

test('a task becomes the sections the page draws, without template comments', () => {
  const s = sections(spec);
  assert.equal(s.Goal, 'The label shows.');
  assert.deepEqual(items(s.Assumed), ['the helper takes the old shape']);
  assert.deepEqual(items(s.Approach), [
    'Change src/notify.py:3 to call src/labels.py:1.',
    'Test it.',
  ]);
  assert.deepEqual(items(s['Out of scope']), []);
  assert.deepEqual(items(s['Definition of done']), ['the label shows']);
});

test('only paths that exist become links, with their line', () => {
  const root = repo();
  const found = mentions(root, 'see src/labels.py:1 and src/missing.py and e.g. and/or');
  assert.deepEqual(found, [{ path: 'src/labels.py', line: 1 }]);
});

test('the snapshot marks a declared file that does not exist yet as new', () => {
  const root = repo();
  const [task] = snapshot(config(root)).tasks;
  assert.equal(task.title, 'SMM notifications read the list value');
  assert.deepEqual(task.files, [
    { path: 'src/notify.py', exists: true },
    { path: 'test/test_notify.py', exists: false },
  ]);
  assert.ok(task.mentions.some((m) => m.path === 'src/labels.py' && m.line === 1));
});

test('the file viewer reads lines and the browser lists folders first', () => {
  const root = repo();
  assert.deepEqual(readSource(root, 'src/notify.py').lines.slice(0, 3), ['a', 'b', 'c']);
  const top = listDir(root, '');
  assert.equal(top.entries[0].dir, true);
  assert.ok(top.entries.some((e) => e.path === 'src'));
});

// The server on a free port, driven the way the page drives it.
const serve = async (root) => {
  const { server, token } = createWall(config(root), { token: 'tok' });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  // Every call the page makes that changes anything is a POST.
  const call = (path, { body, headers = {} } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: body && JSON.stringify(body),
    }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
  return { call, token, close: () => server.close() };
};

test('a write without the page token is refused, and approving needs a draft', async () => {
  const root = repo();
  const { call, token, close } = await serve(root);
  try {
    assert.equal((await call('/api/approve', { body: { id: '024' } })).status, 403);
    const ok = await call('/api/approve', {
      body: { id: '024' },
      headers: { 'x-crew-token': token },
    });
    assert.equal(ok.status, 200);
    assert.match(
      readFileSync(join(root, '.claude/tasks/024-smm.md'), 'utf8'),
      /^status: approved$/m,
    );
    const again = await call('/api/approve', {
      body: { id: '024' },
      headers: { 'x-crew-token': token },
    });
    assert.equal(again.body.error, 'task is approved, not draft');
    const ran = await call('/api/run', {
      body: { id: '024' },
      headers: { 'x-crew-token': token },
    });
    assert.match(ran.body.command, /claude --model sonnet /);
  } finally {
    close();
  }
});

test('the scout is run read-only, with the message on stdin', async () => {
  const root = repo();
  const bin = join(root, 'fake-claude');
  writeFileSync(
    bin,
    `#!/bin/sh\nargs="$*"\nmsg=$(cat)\nprintf '{"result":"%s|%s","session_id":"s-123456789"}' "$msg" "$(echo "$args" | grep -c 'disallowedTools Edit Write')"\n`,
    { mode: 0o755 },
  );
  const answer = await askScout(config(root), '--not-a-flag where is it?', null, bin);
  assert.equal(answer.text, '--not-a-flag where is it?|1');
  assert.equal(answer.session, 's-123456789');
  const missing = await askScout(config(root), 'x', null, join(root, 'nope'));
  assert.match(missing.error, /not on PATH/);
});
