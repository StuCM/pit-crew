import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('planning/scripts/graph_propose.py');

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-'));
  const arch = {
    title: 'arch',
    parts: [{ id: 'pa', label: 'Alpha', status: 'agreed' }],
    decisions: [
      { id: 'd1', kind: 'decided', part: 'pa', decided: 'use sqlite', why: 'simple' },
      { id: 'd2', kind: 'decided', part: 'pa', decided: 'use json', why: 'plain' },
      { id: 'n1', kind: 'note', part: 'pa', decided: 'a mere note' },
    ],
  };
  writeFileSync(join(dir, 'arch.json'), JSON.stringify(arch));
  writeFileSync(
    join(dir, 'plan.json'),
    JSON.stringify({
      name: 'my-plan',
      destination: 'ship the thing',
      maps: { architecture: { file: 'arch.json' } },
      out_of_scope: [{ what: 'mobile app', why: 'desktop first' }],
      fog: ['who will host it'],
      open: ['which cloud?'],
    }),
  );
  return dir;
};

const propose = (...args) => {
  const r = spawnSync('python3', [SCRIPT, 'plan.json', '--json', '--project', 'demo', ...args], {
    cwd: setup(),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).proposed;
};

const find = (nodes, type, text) =>
  nodes.find((n) => n.type === type && (n.label ?? n.name).includes(text));

test('hub, plan, constraint and decisions carry the links the tree reads', () => {
  const nodes = propose();
  const hub = find(nodes, 'Concept', 'demo planning');
  assert.deepEqual(hub.linkedFrom, [['hasConcept', 'Project/demo']]);

  const plan = find(nodes, 'Task', 'my-plan');
  assert.equal(plan.destination, 'ship the thing');
  assert.deepEqual(plan.links, [
    ['partOf', 'Project/demo'],
    ['hasConcept', 'Concept/demo planning'],
    ['hasConstraint', 'Constraint/mobile app'],
  ]);

  const constraint = find(nodes, 'Constraint', 'mobile app');
  assert.equal(constraint.description, 'desktop first');

  const decision = find(nodes, 'Decision', 'use sqlite');
  assert.deepEqual(decision.links, [['affects', 'Task/my-plan']]);
});

test('every proposal is searchable by the project prefix', () => {
  const nodes = propose();
  assert.ok(nodes.length >= 4);
  for (const n of nodes) assert.match(n.sourceContext, /^demo__\d{4}-\d{2}-\d{2}$/);
});

test('fog, open questions and notes never reach the graph', () => {
  const text = JSON.stringify(propose());
  assert.ok(text.includes('my-plan'));
  for (const gone of ['who will host', 'which cloud', 'a mere note']) {
    assert.ok(!text.includes(gone), gone);
  }
});

test('--only proposes just that decision plus hub and plan', () => {
  const nodes = propose('--only', 'd1');
  assert.deepEqual(nodes.map((n) => n.type).sort(), ['Concept', 'Decision', 'Task']);
  assert.ok(find(nodes, 'Decision', 'use sqlite'));
  assert.deepEqual(find(nodes, 'Task', 'my-plan').links.length, 2);
});
