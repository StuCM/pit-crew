import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SKILLS = resolve('planning/skills');
const OPEN = join(SKILLS, 'open-threads/scripts');
const py = (script, args, cwd) =>
  spawnSync('python3', [script, ...args], { cwd, encoding: 'utf8' });

const part = (id, label, extra = {}) => ({
  id,
  label,
  status: 'proposed',
  open: [`how should ${id} work?`],
  ...extra,
});

const setup = (parts, plan = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'rank-'));
  writeFileSync(join(dir, 'arch.json'), JSON.stringify({ title: 't', parts, edges: [] }));
  writeFileSync(
    join(dir, 'plan.json'),
    JSON.stringify({ name: 'x', maps: { architecture: { file: 'arch.json' } }, ...plan }),
  );
  return dir;
};
const rank = (dir) => py(join(OPEN, 'rank_threads.py'), ['plan.json'], dir).stdout;

test('the part named in the destination ranks first and says why', () => {
  const dir = setup([part('pa', 'Alpha'), part('pb', 'Beta')], {
    destination: 'ship the Beta part',
  });
  const out = rank(dir);
  assert.ok(out.indexOf('how should pb') < out.indexOf('how should pa'));
  assert.match(out, /names the destination/);
  assert.doesNotMatch(out, /No destination yet/);
});

test('a missing destination is the first line', () => {
  const out = rank(setup([part('pa', 'Alpha')]));
  assert.match(out.split('\n')[0], /No destination yet/);
});

test('rejected and out-of-scope questions are not threads', () => {
  const dir = setup(
    [
      part('pa', 'Alpha', { status: 'rejected' }),
      part('pb', 'Beta', { open: ['keep me?', 'drop me?'] }),
    ],
    { destination: 'd', out_of_scope: [{ what: 'w', why: 'r', question: 'Drop Me?' }] },
  );
  const out = rank(dir);
  assert.match(out, /keep me\?/);
  assert.doesNotMatch(out, /how should pa/);
  assert.doesNotMatch(out, /drop me/);
});

test('research threads are listed apart and fog is printed', () => {
  const dir = setup(
    [part('pa', 'Alpha', { open: [{ q: 'look it up', type: 'research' }, 'talk it over?'] })],
    { destination: 'd', fog: ['something vague'] },
  );
  const out = rank(dir);
  const alone = out.indexOf('Agent can do alone');
  assert.ok(alone > out.indexOf('talk it over?'));
  assert.ok(out.indexOf('look it up') > alone);
  assert.match(out, /Not yet specified[\s\S]*something vague/);
});

const resolveArgs = (extra) => [
  '--map',
  'arch.json',
  '--part',
  'pa',
  '--question',
  'how should',
  '--out-of-scope',
  '--plan',
  'plan.json',
  ...extra,
];
const resolveRun = (dir, extra) => py(join(OPEN, 'resolve.py'), resolveArgs(extra), dir);

test('resolve --out-of-scope moves the question into plan.json', () => {
  const dir = setup([part('pa', 'Alpha')]);
  const r = resolveRun(dir, ['--what', 'pa work', '--why', 'later']);
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
  assert.deepEqual(plan.out_of_scope, [
    { what: 'pa work', why: 'later', question: 'how should pa work?' },
  ]);
  assert.equal(JSON.parse(readFileSync(join(dir, 'arch.json'), 'utf8')).parts[0].open, undefined);
});

test('resolve --out-of-scope refuses a long --what and honours --dry-run', () => {
  const dir = setup([part('pa', 'Alpha')]);
  assert.notEqual(
    resolveRun(dir, ['--what', 'one two three four five six seven eight', '--why', 'r']).status,
    0,
  );
  const before = readFileSync(join(dir, 'plan.json'), 'utf8');
  const r = resolveRun(dir, ['--what', 'w', '--why', 'r', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(dir, 'plan.json'), 'utf8'), before);
  assert.equal(JSON.parse(readFileSync(join(dir, 'arch.json'), 'utf8')).parts[0].open.length, 1);
});

test('resolve --decided matches and closes an object-form question', () => {
  const dir = setup([part('pa', 'Alpha', { open: [{ q: 'which db?', type: 'research' }] })]);
  const r = py(
    join(OPEN, 'resolve.py'),
    ['--map', 'arch.json', '--part', 'pa', '--question', 'which', '--decided', 'pg', '--why', 'y'],
    dir,
  );
  assert.equal(r.status, 0, r.stderr);
  const map = JSON.parse(readFileSync(join(dir, 'arch.json'), 'utf8'));
  assert.equal(map.parts[0].open, undefined);
  assert.equal(map.decisions[0].question, 'which db?');
});

test('build_tasks puts the question text, not the dict, in a blocker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rank-'));
  const feature = {
    title: 't',
    edges: [],
    parts: [
      {
        id: 'pa',
        label: 'Alpha',
        status: 'new',
        open: [{ q: 'which db?', type: 'research' }],
        surface: [{ name: 'f', file: 'a.py', use: 'add', verified: true }],
      },
    ],
  };
  writeFileSync(join(dir, 'feature.json'), JSON.stringify(feature));
  const r = py(
    join(SKILLS, 'agent-tasks/scripts/build_tasks.py'),
    ['feature.json', '--check'],
    dir,
  );
  assert.match(r.stdout, /\[question\] which db\?/);
});
