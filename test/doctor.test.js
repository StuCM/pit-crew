import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { taskStateLeaks, tooOldForMods } from '../src/commands/doctor.js';
import { sandbox, task, writeTask } from './helpers.js';

test('tooOldForMods compares against 2.1.286', () => {
  assert.equal(tooOldForMods('2.1.285 (Claude Code)'), true);
  assert.equal(tooOldForMods('2.0.999 (Claude Code)'), true);
  assert.equal(tooOldForMods('2.1.286 (Claude Code)\n'), false);
  assert.equal(tooOldForMods('2.1.293 (Claude Code)'), false);
  assert.equal(tooOldForMods('3.0.0'), false);
  assert.equal(tooOldForMods('garbage'), null);
  assert.equal(tooOldForMods(''), null);
});

test('a repository that tracks .claude/tasks is flagged', () => {
  const root = sandbox();
  const run = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  run('init', '-q', '-b', 'main');
  writeTask(root, '001-thing.md', task());
  run('add', '-A');

  const leaks = taskStateLeaks(root);
  assert.deepEqual(leaks.tracked, ['.claude/tasks/001-thing.md']);
  assert.ok(leaks.unignored.includes('.claude/tasks/'));
});
