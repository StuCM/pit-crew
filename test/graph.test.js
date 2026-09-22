import { test } from 'node:test';
import assert from 'node:assert/strict';
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
