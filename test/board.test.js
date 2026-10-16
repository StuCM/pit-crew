import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, run } from '../src/commands/board.js';
import { statuses } from '../src/lib/config.js';
import { config, sandbox, task as taskFile, writeTask } from './helpers.js';

const cfg = config('/nowhere', {
  reviewRounds: 2,
  environments: {
    tv: { proves: ['decode'], reachableFromAgents: false, note: 'the panel decides' },
  },
});
const known = statuses(cfg);

const task = (id, status, extra = {}) => ({
  id,
  file: `${id}-x.md`,
  title: `task ${id}`,
  meta: { status, branch: `crew/${id}-x`, env: 'laptop', ...extra },
});

test('waiting on a person comes before everything else', () => {
  const { text } = render(
    [task('001', 'done'), task('002', 'building'), task('003', 'draft'), task('004', 'approved')],
    known,
    ['crew/002-x', 'crew/003-x', 'crew/004-x'],
    cfg,
  );
  const rows = text.split('\n').filter((line) => /^\| \d{3} /.test(line));
  assert.deepEqual(
    rows.map((row) => row.split(' | ')[2].replace(/`/g, '')),
    ['draft', 'building', 'approved', 'done'],
  );
});

test('the waiting section names the reason, per status', () => {
  const { text, waiting } = render(
    [
      task('001', 'draft'),
      task('002', 'pending-tv'),
      task('003', 'blocked'),
      task('004', 'review'),
    ],
    known,
    [],
    cfg,
  );
  const section = text.split('## Waiting on you')[1].split('## In flight')[0];

  assert.equal(waiting.length, 3);
  assert.match(section, /\*\*001 task 001\*\* — spec needs your approval/);
  assert.match(section, /\*\*002 task 002\*\* — the panel decides/);
  assert.match(section, /\*\*003 task 003\*\* — 2 review rounds disagreed/);
  assert.ok(!section.includes('**004'), 'a task in review is not waiting on a person');
  assert.match(text.split('## In flight')[1], /\*\*004 task 004\*\*/);
});

test('a branch that no longer exists is marked, not dropped', () => {
  const { text } = render([task('001', 'building')], known, [], cfg);
  assert.match(text, /crew\/001-x \*\(gone\)\*/);

  const { text: live } = render([task('001', 'building')], known, ['crew/001-x'], cfg);
  assert.match(live, /\| crew\/001-x \|/);
  assert.ok(!live.includes('(gone)'));
});

test('a status crew does not know about is flagged rather than hidden', () => {
  const { text } = render([task('001', 'in-progress')], known, [], cfg);
  assert.match(text, /\| 001 \| task 001 \| `in-progress` \*\(unknown\)\*/);
});

test('in flight shows the round count once there is one', () => {
  const { text } = render([task('001', 'review', { rounds: '2' })], known, ['crew/001-x'], cfg);
  assert.match(text, /`review` on `crew\/001-x`, round 2\/2/);

  const { text: fresh } = render([task('002', 'building', { rounds: '0' })], known, [], cfg);
  assert.ok(!fresh.includes('round'), 'round 0 should not be shown');
});

test('an empty board says so in both sections', () => {
  const { text, total } = render([], known, [], cfg);
  assert.equal(total, 0);
  assert.match(text, /\*no tasks yet\*/);
  assert.match(text, /## Waiting on you\n\nNothing\./);
  assert.match(text, /## In flight\n\nNothing running\./);
});

test('--json prints the tasks and statuses, and leaves BOARD.md alone', () => {
  const root = sandbox();
  writeTask(root, '001-a.md', taskFile({ status: 'draft', extra: 'model: opus\n' }));
  writeTask(root, '002-b.md', taskFile({ status: 'building' }));
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(line);
  try {
    assert.equal(run(config(root), ['--json']), 0);
  } finally {
    console.log = log;
  }
  const board = JSON.parse(lines.join('\n'));
  assert.equal(board.project, 'Test');
  assert.deepEqual(
    board.tasks.map((t) => [t.status, t.model, t.title]),
    [
      ['draft', 'opus', 'A thing'],
      ['building', null, 'A thing'],
    ],
  );
  assert.ok(board.statuses.draft.waitsOnUser);
  assert.equal(existsSync(join(root, '.claude', 'tasks', 'BOARD.md')), false);
});

const sh = (cwd, cmd) => execSync(cmd, { cwd, stdio: 'pipe' });

// base has the task `building` on main; crew/007-thing carries `status`.
const liveRepo = (branchStatus) => {
  const root = sandbox();
  const file = join(root, '.claude', 'tasks', '007-thing.md');
  writeTask(root, '007-thing.md', taskFile({ status: 'building' }));
  sh(root, 'git init -q -b main && git config user.email a@b.c && git config user.name t');
  sh(root, 'git add -A && git commit -qm base');
  sh(root, 'git switch -qc crew/007-thing');
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace('status: building', `status: ${branchStatus}`),
  );
  sh(root, 'git commit -qam work && git switch -q main');
  return { root, file };
};

const boardStatus = (root) => {
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(line);
  try {
    run(config(root), ['--json']);
  } finally {
    console.log = log;
  }
  return JSON.parse(lines.join('\n')).tasks[0].status;
};

test('an unmerged branch commit is what the board shows, in BOARD.md too', () => {
  const { root } = liveRepo('done');
  assert.equal(boardStatus(root), 'done');
  run(config(root), []);
  assert.match(
    readFileSync(join(root, '.claude', 'tasks', 'BOARD.md'), 'utf8'),
    /\| 007 \| A thing \| `done`/,
  );
});

test('a merged branch shows the main checkout copy', () => {
  const { root } = liveRepo('done');
  sh(root, 'git merge -q crew/007-thing');
  writeTask(root, '007-thing.md', taskFile({ status: 'blocked' }));
  assert.equal(boardStatus(root), 'blocked');
});

test('an uncommitted worktree edit beats the branch commit', () => {
  const { root } = liveRepo('done');
  const tree = `${root}-wt`;
  sh(root, `git worktree add -q ${tree} crew/007-thing`);
  const copy = join(tree, '.claude', 'tasks', '007-thing.md');
  writeFileSync(copy, readFileSync(copy, 'utf8').replace('status: done', 'status: blocked'));
  assert.equal(boardStatus(root), 'blocked');
});

test('a just-cut branch shows its worktree copy, though it counts as merged', () => {
  const root = sandbox();
  writeTask(root, '007-thing.md', taskFile({ status: 'approved' }));
  sh(root, 'git init -q -b main && git config user.email a@b.c && git config user.name t');
  sh(root, 'git add -A && git commit -qm base');
  const tree = `${root}-fresh`;
  sh(root, `git worktree add -q -b crew/007-thing ${tree}`);
  const copy = join(tree, '.claude', 'tasks', '007-thing.md');
  writeFileSync(copy, readFileSync(copy, 'utf8').replace('status: approved', 'status: building'));
  assert.equal(boardStatus(root), 'building');
});

test('a deleted branch falls back to the main checkout copy', () => {
  const { root } = liveRepo('done');
  sh(root, 'git branch -D crew/007-thing');
  assert.equal(boardStatus(root), 'building');
});

test('a task file deleted in the worktree falls back to the branch copy', () => {
  const { root } = liveRepo('done');
  const tree = `${root}-wt2`;
  sh(root, `git worktree add -q ${tree} crew/007-thing`);
  rmSync(join(tree, '.claude', 'tasks', '007-thing.md'));
  assert.equal(boardStatus(root), 'done');
});
