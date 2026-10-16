import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { sandbox, config } from './helpers.js';
import { run, readClaim } from '../src/commands/orchestrator.js';

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });

const repo = () => {
  const root = sandbox();
  sh(root, 'init', '-q', '-b', 'main');
  sh(
    root,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init',
  );
  return root;
};

const quiet = (fn) => {
  const { log, error } = console;
  console.log = console.error = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { log, error });
  }
};

test('claim, refused second claim, force, show, release', () => {
  const cfg = config(repo());
  assert.equal(run(cfg, ['claim', 'a']), 0);
  assert.equal(readClaim(cfg).session, 'a');
  assert.equal(run(cfg, ['claim', 'a']), 0);
  assert.equal(
    quiet(() => run(cfg, ['claim', 'b'])),
    1,
  );
  assert.equal(readClaim(cfg).session, 'a');
  assert.equal(run(cfg, ['claim', 'b', '--force']), 0);
  assert.equal(readClaim(cfg).session, 'b');
  assert.equal(readClaim(cfg).title, 'Orchestrator · Test');
  run(cfg, ['release']);
  assert.equal(readClaim(cfg), null);
});

test('a claim made in a linked worktree is read from the main checkout', () => {
  const root = repo();
  const wt = join(sandbox(), 'wt');
  sh(root, 'worktree', 'add', '-q', wt, '-b', 'other');
  run(config(wt), ['claim', 'a']);
  assert.equal(readClaim(config(root)).session, 'a');
});
