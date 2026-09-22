import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onPath } from '../src/commands/preflight.js';

test('a bare name is looked up on PATH', () => {
  assert.equal(onPath('sh'), true);
  assert.equal(onPath('definitely-not-a-real-binary-xyz'), false);
});

// CREW_GRAPH_CLI and an environment's `requires` both accept a path. Joining
// one onto every PATH entry can never find it, so the graph silently reported
// itself unavailable however it was pointed at the binary.
test('an absolute path is checked directly, not joined onto PATH', () => {
  assert.equal(onPath('/bin/sh'), true);
  assert.equal(onPath('/bin/definitely-not-here-xyz'), false);
});
