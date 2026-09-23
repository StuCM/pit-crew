import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { askScout, createWall } from '../src/commands/serve.js';
import {
  items,
  listDir,
  mentions,
  readSource,
  readState,
  safePath,
  sections,
  snapshot,
} from '../src/lib/wall.js';
import { config, sandbox, task, writeTask } from './helpers.js';

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
  const [view] = snapshot(config(root)).tasks;
  assert.equal(view.title, 'SMM notifications read the list value');
  assert.deepEqual(view.files, [
    { path: 'src/notify.py', exists: true },
    { path: 'test/test_notify.py', exists: false },
  ]);
  assert.ok(view.mentions.some((m) => m.path === 'src/labels.py' && m.line === 1));
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
  const registry = () => [{ key: 't', name: 't', root, cfg: config(root) }];
  const { server, token } = createWall('t', { token: 'tok', registry });
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

// Stands in for the fixer agent: does what its instructions say, with git,
// so the test proves the fold-in mechanics rather than a model's judgement.
const FAKE_FIXER = `#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const brief = readFileSync(0, 'utf8');
const base = /Base commit: (\\w+)/.exec(brief)[1];
const items = JSON.parse(brief.slice(brief.indexOf('[')));
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });
for (const s of items) {
  const text = readFileSync(s.path, 'utf8').replace(s.quote, s.replaceWith);
  writeFileSync(s.path, text);
  git('add', s.path);
  git('commit', '-q', '--fixup=' + s.belongsIn.split(' ')[1]);
}
git('rebase', '-q', '-i', '--autosquash', base);
const results = items.map((s) => ({ id: s.id, status: 'applied', note: 'done' }));
process.stdout.write(JSON.stringify({ result: 'ok ' + JSON.stringify({ results, rebased: true, gate: 'passed' }) }));
`;

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

// The fixer runs in the background, so wait until it has reported.
const settled = async (root, tries = 50) => {
  if (tries === 0 || readState(root).suggestions[0].status !== 'applying') return;
  await new Promise((done) => setTimeout(done, 100));
  return settled(root, tries - 1);
};

const branchWithTwoCommits = (lines) => {
  const root = sandbox();
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  writeFileSync(join(root, 'a.ts'), `${lines.join('\n')}\n`);
  writeTask(root, '007-thing.md', task({ status: 'review', files: ['a.ts'] }));
  sh(root, 'add', '-A');
  sh(root, 'commit', '-qm', 'base');
  const tree = `${root}-007`;
  sh(root, 'worktree', 'add', '-q', '-b', 'crew/007-thing', tree);
  return { root, tree };
};

const wall = async (root, bin) => {
  const cfg = config(root, { baseBranch: 'main' });
  const registry = () => [{ key: 't', name: 't', root, cfg }];
  const { server, token } = createWall('t', { token: 'tok', registry, claude: bin });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const post = (p, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-crew-token': token },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  return { post, close: () => server.close() };
};

test('a suggestion two commits back is folded into its commit, leaving no fixup behind', async () => {
  const lines = ['one', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const { root, tree } = branchWithTwoCommits(lines);
  writeFileSync(join(tree, 'a.ts'), `${['one', 'two', ...lines.slice(2)].join('\n')}\n`);
  sh(tree, 'commit', '-qam', 'feat: two');
  appendFileSync(join(tree, 'a.ts'), 'three\n');
  sh(tree, 'commit', '-qam', 'feat: three');
  const bin = join(root, 'fake-fixer');
  writeFileSync(bin, FAKE_FIXER, { mode: 0o755 });
  const { post, close } = await wall(root, bin);
  try {
    const made = await post('/api/suggest', {
      task: '007',
      path: 'a.ts',
      line: 2,
      quote: 'two',
      note: 'say 2',
      replacement: '2',
    });
    assert.equal(made.suggestions[0].target.subject, 'feat: two');
    assert.equal((await post('/api/apply', { id: '007' })).started, 1);
    await settled(root);
    assert.equal(readState(root).suggestions[0].status, 'applied');
    assert.deepEqual(sh(tree, 'log', '--format=%s', 'main..HEAD').split('\n'), [
      'feat: three',
      'feat: two',
    ]);
    assert.equal(sh(tree, 'show', 'HEAD~1:a.ts').split('\n')[1], '2');
    assert.match(readFileSync(join(tree, 'a.ts'), 'utf8'), /^one\n2\n[\s\S]*three\n$/);
  } finally {
    close();
  }
});

test('a fix that cannot fold in cleanly is undone, reported, and leaves no rebase half-done', async () => {
  const { root, tree } = branchWithTwoCommits(['one']);
  writeFileSync(join(tree, 'a.ts'), 'one\ntwo\n');
  sh(tree, 'commit', '-qam', 'feat: two');
  appendFileSync(join(tree, 'a.ts'), 'three\n');
  sh(tree, 'commit', '-qam', 'feat: three');
  const bin = join(root, 'fake-fixer');
  writeFileSync(bin, FAKE_FIXER, { mode: 0o755 });
  const { post, close } = await wall(root, bin);
  try {
    await post('/api/suggest', {
      task: '007',
      path: 'a.ts',
      line: 2,
      quote: 'two',
      note: 'x',
      replacement: '2',
    });
    await post('/api/apply', { id: '007' });
    await settled(root);
    const item = readState(root).suggestions[0];
    assert.equal(item.status, 'failed');
    assert.match(item.reply, /conflicted and was undone/);
    assert.equal(sh(tree, 'status', '--porcelain'), '');
    assert.match(sh(tree, 'log', '-1', '--format=%s'), /^fixup! feat: two$/);
  } finally {
    close();
  }
});
