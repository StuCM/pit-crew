import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dispatch } from '../src/commands/dispatch.js';
import { findTask } from '../src/lib/handover.js';
import { config, sandbox, task, writeTask } from './helpers.js';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const statusOf = (path) => /^status: (.+)$/m.exec(readFileSync(path, 'utf8'))[1];

// A repository on main with task 007 committed, and the crew config and brief
// left untracked, as .claude/ is in a real repository.
const fixture = ({ status = 'approved' } = {}) => {
  const root = sandbox();
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), 'one\n');
  writeTask(root, '007-thing.md', task({ status, extra: 'model: opus\n' }));
  sh(root, 'add', '-A');
  sh(root, 'commit', '-qm', 'base');
  writeFileSync(
    join(root, '.claude', 'crew.config.json'),
    JSON.stringify({ project: 'p', verify: 'true', worktreeDir: '.' }),
  );
  mkdirSync(join(root, '.claude', 'crew'));
  writeFileSync(join(root, '.claude', 'crew', 'project.md'), '# Project brief\n');
  const cfg = config(root, { worktreeDir: '.', project: 'p' });
  return { root, cfg, file: join(root, '.claude', 'tasks', '007-thing.md') };
};

const crew = (cwd, ...args) => spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });

test('a task is found by its id, padded or not, and by its path', () => {
  const { cfg } = fixture();
  assert.equal(findTask(cfg, '7').id, '007');
  assert.equal(findTask(cfg, '007').id, '007');
  assert.equal(findTask(cfg, '.claude/tasks/007-thing.md').id, '007');
  assert.equal(findTask(cfg, '8'), null);
});

test('crew dispatch --json cuts the worktree and prints a card that ends in the brief', () => {
  const { root, file } = fixture();
  const out = crew(root, 'dispatch', '7', '--json');
  assert.equal(out.status, 0, out.stderr);
  const result = JSON.parse(out.stdout);

  const tree = join(root, 'p-007');
  assert.equal(result.worktree, tree);
  assert.equal(sh(tree, 'rev-parse', '--abbrev-ref', 'HEAD'), 'crew/007-thing');
  assert.equal(sh(tree, 'rev-parse', 'HEAD'), sh(root, 'rev-parse', 'main'));
  assert.equal(result.model, 'opus');
  assert.match(result.card.title, /^Task 007: A thing$/);
  assert.ok(result.card.prompt.includes(`path: ${JSON.stringify(tree)}`));
  assert.match(result.card.prompt, /set_session_model.*/);
  assert.ok(result.card.prompt.includes('`opus`'));
  assert.ok(result.card.prompt.endsWith(result.brief));
  assert.match(result.brief, /crew-worker skill for task \.claude\/tasks\/007-thing\.md/);

  assert.ok(existsSync(join(tree, '.claude', 'crew.config.json')));
  assert.equal(
    readFileSync(join(tree, '.claude', 'crew', 'project.md'), 'utf8'),
    '# Project brief\n',
  );
  assert.equal(statusOf(join(tree, '.claude', 'tasks', '007-thing.md')), 'building');
  assert.equal(statusOf(file), 'approved', 'the main checkout copy is left alone');
  assert.match(readFileSync(join(root, '.claude', 'crew', 'log.jsonl'), 'utf8'), /"dispatch"/);

  const board = JSON.parse(crew(root, 'board', '--json').stdout);
  assert.equal(board.tasks[0].status, 'building');
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
  assert.ok(result.copied.includes('.claude/tasks/008-other.md'));
  assert.equal(statusOf(join(result.worktree, '.claude', 'tasks', '008-other.md')), 'building');
});

test('a draft is refused and nothing is created', () => {
  const { root, file } = fixture({ status: 'draft' });
  const out = crew(root, 'dispatch', '7', '--json');
  assert.notEqual(out.status, 0);
  assert.match(JSON.parse(out.stdout).reason, /not approved/);
  assert.equal(existsSync(join(root, 'p-007')), false);
  assert.equal(sh(root, 'branch', '--list', 'crew/007-thing'), '');
  assert.equal(statusOf(file), 'draft');
});

test('an unmerged branch touching the same files refuses, unless forced', () => {
  const { root, cfg } = fixture();
  sh(root, 'switch', '-qc', 'other');
  writeFileSync(join(root, 'src', 'a.ts'), 'two\n');
  sh(root, 'commit', '-qam', 'feat: two');
  sh(root, 'switch', '-q', 'main');

  const refused = dispatch(cfg, findTask(cfg, '7'));
  assert.equal(refused.ok, false);
  assert.deepEqual(
    refused.collisions.map((hit) => [hit.branch, hit.path]),
    [['other', 'src/a.ts']],
  );
  assert.equal(existsSync(join(root, 'p-007')), false);
  assert.equal(dispatch(cfg, findTask(cfg, '7'), { force: true }).ok, true);
});
