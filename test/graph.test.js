import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILES_QUERY, SCOPED } from '../src/commands/graph.js';

// Every value in these queries comes from a task file or a config, both of
// which agents write. A quote that closed the string literal early would let
// a `files:` entry rewrite the query it appears in.
test('a quote in a path cannot close the SPARQL literal', () => {
  const query = FILES_QUERY(["src/a'.ts"], 10);
  assert.match(query, /src\/a\\'\.ts/);
  assert.doesNotMatch(query, /'src\/a'\.ts'/);
});

test('a newline in a project name cannot inject a clause', () => {
  const query = SCOPED('Pattern', 'proj\nFILTER(false)', 10);
  assert.doesNotMatch(query, /\n\s*FILTER\(false\)/);
});

test('several paths become alternatives, not separate queries', () => {
  const query = FILES_QUERY(['a.ts', 'b.ts'], 10);
  assert.equal((query.match(/STRSTARTS/g) || []).length, 2);
  assert.match(query, /\|\|/);
  assert.match(query, /LIMIT 10/);
});

test('chain hands the text, depth and limit to the graph CLI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-graph-'));
  const cli = join(dir, 'fake-graph');
  writeFileSync(cli, '#!/bin/sh\nprintf "%s|" "$@"\n');
  chmodSync(cli, 0o755);
  process.env.CREW_GRAPH_CLI = cli;
  const { run } = await import('../src/commands/graph.js?chain');
  const written = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => written.push(String(chunk));
  try {
    run({ project: 'p' }, ['chain', 'status', 'review', '--depth=9']);
  } finally {
    process.stdout.write = write;
  }
  assert.equal(written.join(''), 'chain|status review|--depth=3|--limit=40|');
});
