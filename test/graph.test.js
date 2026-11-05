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

const fakeTree = async (rows, tag) => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-graph-'));
  const cli = join(dir, 'fake-graph');
  writeFileSync(cli, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(rows)}\nEOF\n`);
  chmodSync(cli, 0o755);
  process.env.CREW_GRAPH_CLI = cli;
  const { run } = await import(`../src/commands/graph.js?${tag}`);
  return (args) => {
    const written = [];
    const write = process.stdout.write;
    process.stdout.write = (chunk) => written.push(String(chunk));
    let code;
    try {
      code = run({ project: 'x' }, args);
    } finally {
      process.stdout.write = write;
    }
    return { code, out: written.join('') };
  };
};

const TREE_ROWS = [
  {
    plan: 'A',
    destination: 'dA',
    decision: 'D1',
    rationale: 'r',
    supersededBy: 'D2',
    clabel: 'no ui',
    cdesc: 'x',
  },
  {
    plan: 'A',
    destination: 'dA',
    decision: 'D1',
    rationale: 'r',
    supersededBy: 'D2',
    clabel: 'no db',
    cdesc: null,
  },
  {
    plan: 'A',
    destination: 'dA',
    decision: 'D2',
    rationale: null,
    supersededBy: null,
    clabel: 'no ui',
    cdesc: 'x',
  },
  { plan: 'B', destination: 'dB' },
];

test('tree --json folds rows into plans, decisions and out-of-scope', async () => {
  const tree = await fakeTree(TREE_ROWS, 'treejson');
  const { out } = tree(['tree', 'x', '--json']);
  const json = JSON.parse(out);
  assert.equal(json.project, 'x');
  assert.equal(json.hub, 'x planning');
  assert.equal(json.plans.length, 2);
  assert.deepEqual(
    json.plans[0].decisions.map((d) => d.name),
    ['D1', 'D2'],
  );
  assert.equal(json.plans[0].decisions[0].supersededBy, 'D2');
  assert.deepEqual(
    json.plans[0].outOfScope.map((c) => c.label),
    ['no ui', 'no db'],
  );
  assert.deepEqual(json.plans[1], { name: 'B', destination: 'dB', decisions: [], outOfScope: [] });
});

test('tree prints an indented text tree', async () => {
  const tree = await fakeTree(TREE_ROWS, 'treetext');
  const { code, out } = tree(['tree', 'x']);
  assert.equal(code, 0);
  assert.equal(
    out,
    [
      'x',
      '  x planning',
      '    A — dA',
      '      D1 (superseded by D2)',
      '      D2',
      '      ✗ no ui',
      '      ✗ no db',
      '    B — dB',
      '',
    ].join('\n'),
  );
});

test('tree with no plans says so and exits 0', async () => {
  const tree = await fakeTree([], 'treenone');
  const { code, out } = tree(['tree', 'x']);
  assert.equal(code, 0);
  assert.equal(out, 'No plans in the graph for x.\n');
});
