import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/commands/plan.js';
import { sandbox, config, writeTask, task } from './helpers.js';

const FEATURE = {
  id: 'mermaid-export',
  parts: [
    {
      id: 'p-build',
      label: 'Build script',
      status: 'extend',
      purpose: 'Reads the map JSON and writes the HTML.',
      why_here: 'This is where the new output format hangs.',
      where: ['scripts/build_map.py'],
      not: ['Validating the map'],
      surface: [
        {
          name: 'main',
          file: 'scripts/build_map.py',
          line: 91,
          use: 'modify',
          change: 'Add --format.',
          verified: true,
        },
        { name: 'build', file: 'scripts/build_map.py', use: 'call' },
      ],
    },
    { id: 'p-render', label: 'Renderer', status: 'new', purpose: 'Emits Mermaid.' },
    { id: 'p-cli', label: 'Entry point', status: 'exists', purpose: 'Parses argv.' },
  ],
  edges: [
    { from: 'p-build', to: 'p-render', kind: 'data', label: 'map json' },
    { from: 'p-cli', to: 'p-build', kind: 'depends', label: 'cli' },
    { from: 'p-cli', to: 'p-render', kind: 'data', label: 'unrelated' },
  ],
};

// Captures stdout, because what this command prints *is* its behaviour —
// a worker reads the text, so asserting on a return value proves nothing.
const capture = (fn) => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
};

const withPlan = (feature = FEATURE) => {
  const root = sandbox();
  const plans = join(root, '.claude', 'plans');
  mkdirSync(join(plans, 'maps'), { recursive: true });
  writeFileSync(
    join(plans, 'plan.json'),
    JSON.stringify({ name: 'Mermaid export', maps: { feature: { file: 'maps/feature.json' } } }),
  );
  writeFileSync(join(plans, 'maps', 'feature.json'), JSON.stringify(feature));
  return root;
};

test('a project with no plan says so and does not fail', () => {
  const root = sandbox();
  const out = capture(() => assert.equal(run(config(root), []), 0));
  assert.match(out, /no plan at/);
});

test('with no argument it lists the maps in the manifest', () => {
  const out = capture(() => run(config(withPlan()), []));
  assert.match(out, /Mermaid export/);
  assert.match(out, /feature +3 parts/);
});

test('a part prints its boundaries, its symbols and only its own edges', () => {
  const out = capture(() => run(config(withPlan()), ['p-build']));

  assert.match(out, /Build script {2}\[extend\]/);
  assert.match(out, /Not this part’s job:[\s\S]*Validating the map/);

  // The split that matters: a worker must not edit something marked USING.
  assert.match(out, /Changing:[\s\S]*modify +main +scripts\/build_map\.py:91/);
  assert.match(out, /Using — do not change these:[\s\S]*call +build/);

  assert.match(out, /→ data "map json" +Renderer/);
  assert.match(out, /← depends "cli"/);
  // p-cli → p-render touches neither end of p-build.
  assert.doesNotMatch(out, /unrelated/);
});

test('an unverified symbol is marked, a verified one is not', () => {
  const out = capture(() => run(config(withPlan()), ['p-build']));
  assert.doesNotMatch(out, /main +scripts\/build_map\.py:91 +\[unverified\]/);
  assert.match(out, /call +build +scripts\/build_map\.py +\[unverified\]/);
});

test('an open question on the part is shouted about', () => {
  const open = structuredClone(FEATURE);
  open.parts[0].open = ['Separate .mmd file, or a fenced block?'];
  const out = capture(() => run(config(withPlan(open)), ['p-build']));
  assert.match(out, /OPEN QUESTIONS ON THIS PART/);
  assert.match(out, /Set status: blocked/);
});

test('a task file is resolved through its part: field', () => {
  const root = withPlan();
  const path = writeTask(root, '007-thing.md', task({ extra: 'part: p-build\n' }));
  const out = capture(() => run(config(root), [path]));
  assert.match(out, /Build script/);
});

test('a task with no part: says so rather than guessing one', () => {
  const root = withPlan();
  const path = writeTask(root, '007-thing.md', task());
  const out = capture(() => run(config(root), [path]));
  assert.match(out, /no `part:`/);
});

test('a part id that is in no map is an error, not an empty report', () => {
  assert.throws(() => run(config(withPlan()), ['p-nope']), /no part "p-nope"/);
});
