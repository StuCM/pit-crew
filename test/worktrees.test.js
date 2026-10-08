import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWall } from '../src/commands/serve.js';
import { backToBase, checkoutInMain, listWorktrees, removeWorktree } from '../src/lib/worktrees.js';
import { config, sandbox, task, writeTask } from './helpers.js';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// main, a task worktree where crew puts it with one commit on crew/007-thing,
// and a worktree crew knows nothing about.
const fixture = () => {
  const root = sandbox();
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  writeTask(root, '007-thing.md', task());
  sh(root, 'add', '-A');
  sh(root, 'commit', '-qm', 'base');
  const cfg = config(root, { baseBranch: 'main', worktreeDir: `${root}-wt` });
  const tree = `${root}-wt/Test-007`;
  sh(root, 'worktree', 'add', '-q', '-b', 'crew/007-thing', tree);
  writeFileSync(join(tree, 'a.txt'), 'changed\n');
  sh(tree, 'commit', '-qam', 'feat: change a');
  const other = `${root}-other`;
  sh(root, 'worktree', 'add', '-q', '-b', 'side', other);
  return { root, cfg, tree, other };
};

const byPath = (list) => Object.fromEntries(list.worktrees.map((w) => [w.path, w]));

test('every worktree is listed with its task, state against base, and dirt', () => {
  const { root, cfg, tree, other } = fixture();
  writeFileSync(join(other, 'new.txt'), 'x\n');
  const list = listWorktrees(cfg);
  const w = byPath(list);
  assert.equal(list.worktrees[0].path, root);
  assert.equal(w[root].main, true);
  assert.equal(w[root].branch, 'main');
  assert.equal(w[tree].task.id, '007');
  assert.equal(w[tree].ahead, 1);
  assert.equal(w[tree].behind, 0);
  assert.equal(w[tree].merged, false);
  assert.deepEqual(w[tree].dirty, []);
  assert.equal(w[other].task, null);
  assert.equal(w[other].merged, true);
  assert.deepEqual(w[other].dirty, ['?? new.txt']);

  // A finished worker lets go of its branch; the task still names it.
  sh(tree, 'switch', '--detach');
  const detached = byPath(listWorktrees(cfg))[tree];
  assert.equal(detached.branch, null);
  assert.equal(detached.checkout, 'crew/007-thing');
  assert.equal(detached.task.id, '007');
});

test('the main checkout will not move while it has uncommitted changes', () => {
  const { root, cfg } = fixture();
  writeFileSync(join(root, 'a.txt'), 'edited\n');
  const out = checkoutInMain(cfg, 'crew/007-thing');
  assert.match(out.error, /main checkout has uncommitted changes: M a\.txt/);
  assert.equal(sh(root, 'branch', '--show-current'), 'main');
});

test('a branch held by a dirty worktree is left where it is', () => {
  const { root, cfg, tree } = fixture();
  writeFileSync(join(tree, 'a.txt'), 'more\n');
  assert.match(checkoutInMain(cfg, 'crew/007-thing').error, /uncommitted changes/);
  assert.equal(sh(tree, 'branch', '--show-current'), 'crew/007-thing');
  assert.equal(sh(root, 'branch', '--show-current'), 'main');
});

test('a task branch is checked out in main by detaching its worktree, and back again', () => {
  const { root, cfg, tree } = fixture();
  const out = checkoutInMain(cfg, 'crew/007-thing');
  assert.equal(out.ok, true);
  assert.equal(sh(root, 'branch', '--show-current'), 'crew/007-thing');
  assert.equal(sh(tree, 'branch', '--show-current'), '');
  assert.equal(listWorktrees(cfg).returnTo, 'main');

  // Hopping to another branch still remembers where it all began.
  assert.equal(checkoutInMain(cfg, 'side').ok, true);
  assert.equal(listWorktrees(cfg).returnTo, 'main');

  assert.deepEqual(backToBase(cfg), { ok: true, branch: 'main' });
  assert.equal(sh(root, 'branch', '--show-current'), 'main');
  assert.equal(listWorktrees(cfg).returnTo, null);
});

test('only a branch that exists is passed to git', () => {
  const { cfg } = fixture();
  assert.equal(checkoutInMain(cfg, '--orphan=x').error, 'not a local branch');
  assert.equal(checkoutInMain(cfg, 'nope').error, 'not a local branch');
});

test('a skip-worktree file that blocks the switch is named', () => {
  const { root, cfg } = fixture();
  sh(root, 'update-index', '--skip-worktree', 'a.txt');
  writeFileSync(join(root, 'a.txt'), 'local only\n');
  const out = checkoutInMain(cfg, 'crew/007-thing');
  assert.match(out.error, /skip-worktree.*a\.txt/);
  assert.equal(sh(root, 'branch', '--show-current'), 'main');
});

test('removing an unmerged or dirty worktree is not done on one click, and the branch stays', () => {
  const { root, cfg, tree, other } = fixture();
  writeFileSync(join(other, 'new.txt'), 'x\n');
  assert.match(removeWorktree(cfg, other, true).error, /uncommitted changes/);
  assert.ok(existsSync(other));

  assert.match(removeWorktree(cfg, tree).confirm, /not merged into main/);
  assert.ok(existsSync(tree));
  assert.equal(removeWorktree(cfg, tree, true).ok, true);
  assert.ok(!existsSync(tree));
  assert.ok(sh(root, 'branch', '--list', 'crew/007-thing'));

  assert.equal(removeWorktree(cfg, root, true).error, 'not a worktree of this repository');
});

test('the page reads the list through the server', async () => {
  const { cfg, tree } = fixture();
  const registry = () => [{ key: 't', name: 't', root: cfg.root, cfg }];
  const { server } = createWall('t', { token: 'tok', registry });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/worktrees?p=t`);
    assert.equal(res.status, 200);
    assert.equal(byPath(await res.json())[tree].task.id, '007');
  } finally {
    server.close();
  }
});
