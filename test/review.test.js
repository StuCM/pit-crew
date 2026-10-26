import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../src/commands/review.js';
import { frontmatter } from '../src/lib/task.js';
import { config, sandbox, task, writeTask } from './helpers.js';

const quietly = (fn) => {
  const { error } = console;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = error;
  }
};

test('a round past the limit blocks the task, saying the rounds stopped it', () => {
  const root = sandbox();
  const path = writeTask(root, '007-thing.md', task({ extra: 'rounds: 2\n' }));
  assert.equal(
    quietly(() => run(config(root, { reviewRounds: 2 }), [path])),
    1,
  );
  const meta = frontmatter(readFileSync(path, 'utf8'));
  assert.equal(meta.status, 'blocked');
  assert.equal(meta['blocked-by'], 'rounds');
  assert.match(meta.blocked, /2 review rounds/);
});
