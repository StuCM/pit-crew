import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PLANNING = resolve('planning');
const py = (script, args, cwd) =>
  spawnSync('python3', [join(PLANNING, script), ...args], { cwd, encoding: 'utf8' });

const part = (open, status) => ({
  id: 'p1',
  label: 'Builder',
  kind: 'service',
  status,
  purpose: 'Builds the thing.',
  why_split: 'Slow.',
  why_here: 'We call it.',
  open,
  evidence: [{ turn: 1, speaker: 'human', quote: 'x' }],
});

const build = (script, map, extra = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'planning-'));
  writeFileSync(join(dir, 'map.json'), JSON.stringify({ title: 't', parts: [map], edges: [] }));
  const r = py(script, ['map.json', '-o', 'out.html', ...extra], dir);
  return { r, dir };
};

test('init_plan --destination writes the key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planning-'));
  execFileSync(
    'python3',
    [join(PLANNING, 'scripts/init_plan.py'), '--name', 'x', '--destination', 'reach y'],
    {
      cwd: dir,
    },
  );
  const plan = JSON.parse(readFileSync(join(dir, '.claude/plans/plan.json'), 'utf8'));
  assert.equal(plan.destination, 'reach y');
});

for (const [name, script, status] of [
  ['architecture', 'skills/architecture-map/scripts/build_arch.py', 'proposed'],
  ['feature', 'skills/feature-map/scripts/build_feature.py', 'new'],
]) {
  test(`${name} map accepts string and typed questions`, () => {
    const { r, dir } = build(
      script,
      part(['plain?', { q: 'look it up', type: 'research' }], status),
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(dir, 'out.html'), 'utf8'), /look it up \[research\]/);
  });

  test(`${name} map rejects an unknown question type`, () => {
    const { r } = build(script, part([{ q: 'x', type: 'bogus' }], status));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /type 'bogus'/);
  });
}

const node = (type) => ({
  id: 'n1',
  label: 'Q',
  status: 'open',
  type,
  evidence: [{ turn: 1, speaker: 'human', quote: 'x' }],
});
const run = (type) => {
  const dir = mkdtempSync(join(tmpdir(), 'planning-'));
  const map = { title: 't', themes: [{ id: 't1', label: 'T', nodes: [node(type)] }] };
  writeFileSync(join(dir, 'map.json'), JSON.stringify(map));
  return py('skills/brainstorm-map/scripts/build_map.py', ['map.json', '-o', 'out.html'], dir);
};
test('brainstorm open node accepts a type and rejects a bogus one', () => {
  assert.equal(run('task').status, 0);
  assert.match(run('bogus').stderr, /type 'bogus'/);
});

test('the two plan.py copies are identical', () => {
  const a = readFileSync(join(PLANNING, 'scripts', 'plan.py'));
  const b = readFileSync(join(PLANNING, 'skills', 'open-threads', 'scripts', 'plan.py'));
  assert.ok(a.equals(b));
});
