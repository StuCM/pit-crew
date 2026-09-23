import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitChanges, parseDiff, suggestionTarget, taskChanges } from '../src/lib/changes.js';
import { readTask } from '../src/lib/task.js';
import { config, sandbox, task, writeTask } from './helpers.js';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// A repository with main, and a task branch checked out in its own worktree:
// one commit inside `files:`, one outside, an uncommitted edit and a new file.
const fixture = () => {
  const root = sandbox();
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), 'one\ntwo\n');
  writeFileSync(join(root, 'src', 'b.ts'), 'b\n');
  const path = writeTask(root, '007-thing.md', task({ files: ['src/a.ts', 'src/new.ts'] }));
  sh(root, 'add', '-A');
  sh(root, 'commit', '-qm', 'base');
  const tree = `${root}-007`;
  sh(root, 'worktree', 'add', '-q', '-b', 'crew/007-thing', tree);
  appendFileSync(join(tree, 'src', 'a.ts'), 'three\n');
  sh(tree, 'commit', '-qam', 'feat: three');
  appendFileSync(join(tree, 'src', 'b.ts'), 'stray\n');
  sh(tree, 'commit', '-qam', 'chore: stray');
  appendFileSync(join(tree, 'src', 'a.ts'), 'four\n');
  writeFileSync(join(tree, 'src', 'new.ts'), 'fresh\n');
  return { root, tree, task: readTask(path, '007-thing.md') };
};

test('a running task shows committed, uncommitted and new work, and what the spec did not allow', () => {
  const { root, tree, task: t } = fixture();
  const c = taskChanges(config(root, { baseBranch: 'main' }), t);
  assert.equal(c.worktree, tree);
  assert.deepEqual(
    c.commits.map((k) => k.subject),
    ['chore: stray', 'feat: three'],
  );
  const by = Object.fromEntries(c.files.map((f) => [f.path, f]));
  assert.deepEqual(Object.keys(by).sort(), ['src/a.ts', 'src/b.ts', 'src/new.ts']);
  assert.equal(by['src/b.ts'].scope, 'outside');
  assert.equal(by['src/a.ts'].scope, 'declared');
  assert.equal(by['src/a.ts'].uncommitted, true);
  assert.equal(by['src/a.ts'].added, 2);
  assert.equal(by['src/new.ts'].status, 'added');
  assert.equal(by['src/b.ts'].uncommitted, false);
});

test('a task with no branch yet says so rather than showing an empty diff', () => {
  const { root } = fixture();
  const path = writeTask(
    root,
    '008-later.md',
    task({}).replace('crew/007-thing', 'crew/008-later'),
  );
  const c = taskChanges(config(root, { baseBranch: 'main' }), readTask(path, '008-later.md'));
  assert.match(c.error, /does not exist yet/);
});

test('one commit can be read on its own, and only by a commit id', () => {
  const { root, tree } = fixture();
  const sha = sh(tree, 'rev-parse', 'HEAD');
  const c = commitChanges(config(root), sha);
  assert.equal(c.subject, 'chore: stray');
  assert.deepEqual(
    c.files.map((f) => f.path),
    ['src/b.ts'],
  );
  assert.equal(commitChanges(config(root), 'HEAD; rm -rf /').error, 'not a commit id');
});

test('a diff keeps both sides of the line numbers', () => {
  const [file] = parseDiff(
    'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -3,2 +3,2 @@ fn\n keep\n-old\n+new\n',
  );
  assert.deepEqual(
    file.hunks[0].lines.map((l) => [l.kind, l.a ?? null, l.b ?? null]),
    [
      [' ', 3, 3],
      ['-', 4, null],
      ['+', null, 4],
    ],
  );
  assert.equal(file.added, 1);
  assert.equal(file.removed, 1);
});

test('a suggested line goes to the commit that wrote it, or the last one to touch its file', () => {
  const { root, tree, task: t } = fixture();
  const cfg = config(root, { baseBranch: 'main' });
  const c = taskChanges(cfg, t);
  // src/a.ts: line 3 "three" was committed by "feat: three"; line 4 is uncommitted.
  assert.equal(suggestionTarget(cfg, c, 'src/a.ts', 3).subject, 'feat: three');
  assert.equal(suggestionTarget(cfg, c, 'src/a.ts', 4).kind, 'uncommitted');
  // Line 1 was there before the task, so it folds into the task's last commit on the file.
  assert.equal(suggestionTarget(cfg, c, 'src/a.ts', 1).subject, 'feat: three');
  // A removed line has no line on the new side; same rule.
  assert.equal(suggestionTarget(cfg, c, 'src/b.ts', 1, 'old').subject, 'chore: stray');
  // A file the branch never committed needs a commit of its own.
  assert.equal(suggestionTarget(cfg, c, 'src/new.ts', 1).kind, 'uncommitted');
  sh(tree, 'stash', '-u');
  assert.equal(suggestionTarget(cfg, taskChanges(cfg, t), 'src/c.ts', null).kind, 'new');
});
