import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FANOUT, FILES_QUERY, SCOPED, SEED_QUERY, chain, iriRef } from '../src/commands/graph.js';

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

// A store small enough to read: rows keyed by the node they touch. The fake
// answers the seed query and the neighbour query the way the CLI prints them.
const fakeStore = (seeds, links) => (sparql) => {
  if (!sparql.includes('VALUES ?me')) return seeds;
  const asked = new Set(
    [...sparql.matchAll(/resource\/(\w+)>/g)].map((m) => `mem:resource/${m[1]}`),
  );
  return links.filter((row) => asked.has(row.me));
};
const node = (id, type, name, extra = {}) => ({
  other: `mem:resource/${id}`,
  type: `mem:${type}`,
  name,
  ...extra,
});
const edge = (me, rel, dir, target) => ({ me: `mem:resource/${me}`, rel, dir, ...target });

test('a chain follows two hops from the words, not the phrase', () => {
  const trap = node('p1', 'Pattern', 'v8 reference datatype comparisons', {
    anchor: 'coral/functions',
    ctx: 'coral-arches__2026-09-10.md',
  });
  const fix = node('d1', 'Decision', 'Read list item ids via a helper');
  const site = node('p2', 'Pattern', 'selectedListItemIds lives in reference-values.js');
  const lines = chain(
    'reference datatype',
    { depth: 2 },
    fakeStore(
      [trap],
      [edge('p1', 'manifestsIn', 'in', fix), edge('d1', 'manifestsIn', 'out', site)],
    ),
  );
  assert.equal(
    lines[0],
    'Pattern "v8 reference datatype comparisons"  [coral-arches @ coral/functions]',
  );
  assert.ok(lines.includes('  ← manifestsIn Decision "Read list item ids via a helper"'));
  assert.ok(
    lines.includes('    manifestsIn → Pattern "selectedListItemIds lives in reference-values.js"'),
  );
});

test('a seed query needs every word, so word order does not matter', () => {
  const query = SEED_QUERY('concepts references', 5);
  assert.equal((query.match(/CONTAINS/g) || []).length, 2);
  assert.match(query, / && CONTAINS/);
});

test('a hub is named and not walked through', () => {
  const seed = node('p1', 'Pattern', 'trap');
  const hub = node('t1', 'Technology', 'Arches');
  const crowd = Array.from({ length: FANOUT + 1 }, (_, i) =>
    edge('t1', 'uses', 'in', node(`n${i}`, 'Pattern', `unrelated ${i}`)),
  );
  const lines = chain(
    'trap',
    { depth: 2 },
    fakeStore([seed], [edge('p1', 'uses', 'out', hub), ...crowd]),
  );
  assert.ok(lines.some((l) => l.includes('Technology "Arches"')));
  assert.ok(!lines.some((l) => l.includes('unrelated 0')));
  assert.ok(lines.includes(`not followed, too many links: Arches (${FANOUT + 1} links)`));
});

test('the project node is never part of a chain', () => {
  const seed = node('p1', 'Pattern', 'trap');
  const lines = chain(
    'trap',
    {},
    fakeStore([seed], [edge('p1', 'appliesTo', 'out', node('x', 'Project', 'coral-arches'))]),
  );
  assert.deepEqual(lines, ['Pattern "trap"']);
});

test('a failed store says so rather than printing an empty chain', () => {
  assert.deepEqual(
    chain('x', {}, () => null),
    ['graph: query failed (the store may be empty)'],
  );
  assert.deepEqual(
    chain('x', {}, () => []),
    ['graph: nothing matches "x"'],
  );
});

test("only the store's own IRIs go back into a query", () => {
  assert.equal(
    iriRef('mem:resource/ab-12'),
    '<https://memory.claude.local/ontology#resource/ab-12>',
  );
  assert.equal(iriRef('mem:resource/x> } DELETE {'), null);
  assert.equal(iriRef('https://evil.example/x'), null);
});

test('a chain says when it ran out of depth rather than out of links', () => {
  const seed = node('p1', 'Pattern', 'trap');
  const next = node('d1', 'Decision', 'the fix');
  const store = fakeStore([seed], [edge('p1', 'resolves', 'in', next)]);
  assert.ok(chain('trap', { depth: 1 }, store).includes('not expanded, depth 1 reached: the fix'));
  assert.ok(!chain('trap', { depth: 2 }, store).some((l) => l.startsWith('not expanded')));
});

test('a query failing part-way is reported, not passed off as the whole chain', () => {
  const seed = node('p1', 'Pattern', 'trap');
  const ask = (sparql) => (sparql.includes('VALUES ?me') ? null : [seed]);
  assert.ok(chain('trap', {}, ask).some((l) => l.startsWith('stopped early')));
});
