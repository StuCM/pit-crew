import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/commands/fix.js';
import { applySuggestions } from '../src/lib/agent.js';
import { suggestionTarget, taskChanges } from '../src/lib/changes.js';
import { readState, writeState } from '../src/lib/wall.js';
import { readTasks } from '../src/lib/task.js';
import { config, sandbox, task, writeTask } from './helpers.js';

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

// Records one open suggestion on task 007, aimed at the commit that owns its line.
const suggest = (root, line, quote, replacement) => {
  const cfg = config(root, { baseBranch: 'main' });
  const found = readTasks(join(cfg.root, cfg.tasksDir)).find((t) => t.id === '007');
  const changes = taskChanges(cfg, found);
  const target = suggestionTarget(cfg, changes, 'a.ts', line, 'new');
  const state = readState(root);
  state.suggestions = [
    {
      id: 's1',
      task: '007',
      path: 'a.ts',
      line,
      quote,
      note: 'x',
      replacement,
      target,
      status: 'open',
    },
  ];
  writeState(root, state);
  return { cfg, found };
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
  const { cfg, found } = suggest(root, 2, 'two', '2');
  assert.equal(readState(root).suggestions[0].target.subject, 'feat: two');
  assert.equal((await applySuggestions(cfg, found, bin)).ok, true);
  assert.equal(readState(root).suggestions[0].status, 'applied');
  assert.deepEqual(sh(tree, 'log', '--format=%s', 'main..HEAD').split('\n'), [
    'feat: three',
    'feat: two',
  ]);
  assert.equal(sh(tree, 'show', 'HEAD~1:a.ts').split('\n')[1], '2');
  assert.match(readFileSync(join(tree, 'a.ts'), 'utf8'), /^one\n2\n[\s\S]*three\n$/);
});

test('a fix that cannot fold in cleanly is undone, reported, and leaves no rebase half-done', async () => {
  const { root, tree } = branchWithTwoCommits(['one']);
  writeFileSync(join(tree, 'a.ts'), 'one\ntwo\n');
  sh(tree, 'commit', '-qam', 'feat: two');
  appendFileSync(join(tree, 'a.ts'), 'three\n');
  sh(tree, 'commit', '-qam', 'feat: three');
  const bin = join(root, 'fake-fixer');
  writeFileSync(bin, FAKE_FIXER, { mode: 0o755 });
  const { cfg, found } = suggest(root, 2, 'two', '2');
  await applySuggestions(cfg, found, bin);
  const item = readState(root).suggestions[0];
  assert.equal(item.status, 'failed');
  assert.match(item.reply, /conflicted and was undone/);
  assert.equal(sh(tree, 'status', '--porcelain'), '');
  assert.match(sh(tree, 'log', '-1', '--format=%s'), /^fixup! feat: two$/);
});

test('crew fix refuses a task nobody has', async () => {
  const root = sandbox();
  assert.equal(await run(config(root), ['999']), 1);
});
