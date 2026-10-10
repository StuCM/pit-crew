import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { approve } from '../src/commands/approve.js';
import { back, checkout, readCheckout } from '../src/commands/checkout.js';
import { dispatch } from '../src/commands/dispatch.js';
import { snapshot } from '../src/commands/tasks.js';
import { findTask } from '../src/lib/handover.js';
import { config, sandbox, task, writeTask } from './helpers.js';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// A repository on main with one approved task, its spec committed.
const fixture = ({ status = 'approved', files = ['src/a.ts'] } = {}) => {
  const root = sandbox();
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), 'one\n');
  writeTask(root, '007-thing.md', task({ status, files }));
  sh(root, 'add', '-A');
  sh(root, 'commit', '-qm', 'base');
  const cfg = config(root, { worktreeDir: '.', project: 'p' });
  return { root, cfg, find: () => findTask(cfg, '7') };
};

test('a task is found by its id, padded or not, and by its path', () => {
  const { cfg } = fixture();
  assert.equal(findTask(cfg, '7').id, '007');
  assert.equal(findTask(cfg, '007').id, '007');
  assert.equal(findTask(cfg, '.claude/tasks/007-thing.md').id, '007');
  assert.equal(findTask(cfg, '8'), null);
});

test('approve moves a draft only', () => {
  const { cfg, find } = fixture({ status: 'draft' });
  assert.equal(approve(cfg, find()).ok, true);
  assert.equal(find().meta.status, 'approved');
  assert.match(approve(cfg, find()).reason, /approved, not draft/);
});

test('dispatch refuses anything but an approved task', () => {
  const { cfg, find } = fixture({ status: 'draft' });
  const result = dispatch(cfg, find());
  assert.equal(result.ok, false);
  assert.match(result.reason, /not approved/);
});

test('dispatch cuts the worktree from base, sets building, and gives the brief', () => {
  const { root, cfg, find } = fixture();
  const result = dispatch(cfg, find());

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.worktree, join(root, 'p-007'));
  assert.equal(sh(result.worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), 'crew/007-thing');
  assert.equal(find().meta.status, 'building');
  assert.equal(result.specCopied, false, 'the spec was committed, so it is already there');
  assert.match(result.brief, /crew-worker skill for task \.claude\/tasks\/007-thing\.md/);
  assert.match(readFileSync(join(root, '.claude', 'crew', 'log.jsonl'), 'utf8'), /"dispatch"/);
});

test('a spec nobody committed is copied into the worktree', () => {
  const { root, cfg } = fixture();
  writeTask(
    root,
    '008-other.md',
    task({ status: 'approved', files: ['src/b.ts'] })
      .replace('id: 007', 'id: 008')
      .replace('crew/007-thing', 'crew/008-other'),
  );
  const result = dispatch(cfg, findTask(cfg, '8'));
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.specCopied, true);
  assert.ok(existsSync(join(result.worktree, '.claude', 'tasks', '008-other.md')));
});

test('dispatch refuses while another task in flight declares the same file', () => {
  const { root, cfg } = fixture();
  writeTask(
    root,
    '009-busy.md',
    task({ status: 'building', files: ['src/'] })
      .replace('id: 007', 'id: 009')
      .replace('crew/007-thing', 'crew/009-busy'),
  );
  const refused = dispatch(cfg, findTask(cfg, '7'));
  assert.equal(refused.ok, false);
  assert.deepEqual(
    refused.overlaps.map((o) => o.id),
    ['009'],
  );
  assert.equal(findTask(cfg, '7').meta.status, 'approved', 'a refusal changes nothing');

  assert.equal(dispatch(cfg, findTask(cfg, '7'), { force: true }).ok, true);
});

test('checkout puts the tip on the bench and leaves the worker alone', () => {
  const { root, cfg, find } = fixture();
  const { worktree } = dispatch(cfg, find());
  writeFileSync(join(worktree, 'src', 'a.ts'), 'two\n');
  sh(worktree, 'commit', '-qam', 'feat: two');
  writeFileSync(join(worktree, 'src', 'a.ts'), 'three, not committed\n');

  const out = checkout(cfg, find());
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.bench, join(root, 'p-bench'));
  assert.equal(readFileSync(join(out.bench, 'src', 'a.ts'), 'utf8'), 'two\n');
  assert.equal(out.uncommittedInWorktree, 1);
  assert.equal(sh(worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), 'crew/007-thing');
  assert.equal(sh(root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'main is untouched');
  assert.equal(readCheckout(root).task, '007');

  const returned = back(cfg);
  assert.equal(returned.ok, true, returned.reason);
  assert.equal(readFileSync(join(out.bench, 'src', 'a.ts'), 'utf8'), 'one\n');
  assert.equal(readCheckout(root), null);
});

test('checkout refuses a bench with uncommitted edits', () => {
  const { cfg, find } = fixture();
  dispatch(cfg, find());
  const { bench } = checkout(cfg, find());
  writeFileSync(join(bench, 'src', 'a.ts'), 'mine\n');
  const out = checkout(cfg, find());
  assert.equal(out.ok, false);
  assert.match(out.reason, /uncommitted changes/);
});

test('bench "." uses the main checkout, and goes back to its branch', () => {
  const { root, find } = fixture();
  const cfg = config(root, { worktreeDir: '.', project: 'p', bench: '.' });
  dispatch(cfg, find());
  sh(root, 'commit', '-qam', 'chore: bookkeeping');

  const out = checkout(cfg, find());
  assert.equal(out.ok, true, out.reason);
  assert.equal(sh(root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD', 'detached');
  assert.equal(back(cfg).ok, true);
  assert.equal(sh(root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
});

test('the snapshot says where each task is', () => {
  const { cfg, find } = fixture();
  dispatch(cfg, find());
  const data = snapshot(cfg);
  const [only] = data.tasks;
  assert.equal(only.status, 'building');
  assert.equal(only.inFlight, true);
  assert.ok(only.worktree.endsWith('p-007'));
  assert.equal(data.checkout, null);
});
