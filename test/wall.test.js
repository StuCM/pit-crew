import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  agentArgs,
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

test('a path-scoped Edit entry keeps Edit allowed; no Edit entry disallows it', () => {
  const agent = new URL('../agents/crew-scout.md', import.meta.url).pathname;
  const scoped = agentArgs(agent, 'a', ['Read', 'Edit(.claude/tasks/1.md)']);
  assert.equal(scoped.includes('--disallowedTools'), false);
  assert.ok(scoped.includes('Edit(.claude/tasks/1.md)'));
  const readOnly = agentArgs(agent, 'a', ['Read']);
  assert.deepEqual(readOnly.slice(readOnly.indexOf('--disallowedTools')), [
    '--disallowedTools',
    'Edit',
    'Write',
    'NotebookEdit',
  ]);
});
