import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dirname, '..', 'src', 'cli.js');

/** A repo with a config, and a fake graph CLI that prints `bytes` of output. */
const sandboxWithFakeGraph = (bytes) => {
  const root = mkdtempSync(join(tmpdir(), 'crew-cli-'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('mkdir', ['-p', join(root, '.claude')]);
  writeFileSync(
    join(root, '.claude', 'crew.config.json'),
    JSON.stringify({ project: 'Big', verify: 'true' }),
  );

  const fake = join(root, 'fake-graph');
  writeFileSync(fake, `#!/bin/sh\nawk 'BEGIN{for(i=0;i<${bytes / 64};i++)printf "%064d\\n", i}'\n`);
  chmodSync(fake, 0o755);
  return { root, fake };
};

// stdout is asynchronous when it is a pipe, so `process.exit` dropped whatever
// had not drained: 648KB of graph context arrived as exactly 64KiB, with no
// error anywhere. Silent truncation of a briefing is worse than no briefing.
test('output larger than a pipe buffer is not truncated', () => {
  const { root, fake } = sandboxWithFakeGraph(640_000);
  const got = spawnSync(process.execPath, [CLI, 'graph', 'prime'], {
    cwd: root,
    env: { ...process.env, CREW_GRAPH_CLI: fake },
    encoding: 'utf8',
    maxBuffer: 10_000_000,
  });

  assert.equal(got.status, 0);
  assert.ok(
    got.stdout.length > 600_000,
    `expected the whole answer, got ${got.stdout.length} bytes`,
  );
});

// The same fix: CREW_GRAPH_CLI is an absolute path, and onPath used to join it
// onto every PATH entry, so pointing crew at a binary could never work.
test('CREW_GRAPH_CLI is honoured when it is a path', () => {
  const { root, fake } = sandboxWithFakeGraph(640);
  const got = spawnSync(process.execPath, [CLI, 'graph', 'prime'], {
    cwd: root,
    env: { ...process.env, CREW_GRAPH_CLI: fake },
    encoding: 'utf8',
  });
  assert.doesNotMatch(got.stdout, /not on PATH/);
});
