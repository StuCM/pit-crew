import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/commands/pre-commit.js';
import { config, sandbox, task, writeTask } from './helpers.js';

test('a commit staging a task file is refused, even with no formatters configured', () => {
  const root = sandbox();
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  assert.equal(run(config(root)), 0);

  writeTask(root, '001-thing.md', task());
  git('add', '-A');
  assert.equal(run(config(root)), 1);
});
