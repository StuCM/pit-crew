import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { groupView, problems, run } from '../src/commands/work.js';
import { frontmatter } from '../src/lib/task.js';
import { WORK_DIR } from '../src/lib/wall.js';
import { config, sandbox, writeTask } from './helpers.js';

const spec = (id, status, extra = '') => `---
id: ${id}
slug: t${id}
status: ${status}
work: smm
${extra}files:
  - src/a.py
---

# Task ${id}
`;

const BRIEF = {
  shape: 'replace',
  target: [{ path: 'coral/functions/notify_smm.py', line: 45, name: 'post_save' }],
  direction: 'Rewrite post_save to read references directly.',
  rejected: [{ option: 'wrap post_save with a converter', why: 'leaves the concept shape alive' }],
  decided: ['concepts became references in the upgrade'],
  exploring: ['maybe the label lookup should move to a helper'],
};

const setup = (work) => {
  const root = sandbox();
  mkdirSync(join(root, WORK_DIR), { recursive: true });
  writeFileSync(join(root, WORK_DIR, 'smm.json'), JSON.stringify({ title: 'SMM labels', ...work }));
  const paths = [
    writeTask(root, '024-a.md', spec('024', 'draft')),
    writeTask(root, '025-b.md', spec('025', 'draft')),
    writeTask(
      root,
      '026-c.md',
      spec('026', 'blocked', 'blocked: needs a migration\nblocked-by: worker\n'),
    ),
  ];
  return { root, cfg: config(root), paths };
};

const call = (cfg, args) => {
  const out = [];
  const err = [];
  const { log, error } = console;
  console.log = (line) => out.push(...String(line).split('\n'));
  console.error = (line) => err.push(line);
  try {
    return { code: run(cfg, args), out, err };
  } finally {
    Object.assign(console, { log, error });
  }
};

const statusOf = (path) => frontmatter(readFileSync(path, 'utf8')).status;

test('the card leads with the shape, the road not taken, and what was only explored', () => {
  const { cfg } = setup({ brief: BRIEF, order: ['026', '024'] });
  const { code, out } = call(cfg, ['smm']);
  assert.equal(code, 0);
  const text = out.join('\n');
  assert.match(text, /shape {6}replace {2}coral\/functions\/notify_smm\.py:45 post_save/);
  assert.match(text, /not {8}wrap post_save with a converter — leaves the concept shape alive/);
  assert.match(text, /exploring {2}maybe the label lookup .* \(said, not decided\)/);
  assert.match(text, /challenge {2}not run/);
  assert.match(text, /026 {2}blocked .* — worker: needs a migration/);
  const ids = out.filter((l) => /^ {2}\d{3} /.test(l)).map((l) => l.trim().slice(0, 3));
  assert.deepEqual(ids, ['026', '024', '025'], 'order: first, then by id');
});

test('approval refuses an unanswered challenge, and a brief without a rejected road', () => {
  assert.deepEqual(
    problems({ brief: { ...BRIEF, rejected: [] }, challenge: { skipped: 'one-line fix' } }),
    ['brief.rejected: name the alternative not taken, and why — or "none considered"'],
  );
  const { cfg, paths } = setup({
    brief: BRIEF,
    challenge: { verdict: 'QUESTION', points: [{ q: 'Why keep the old signature?' }] },
  });
  const { code, err } = call(cfg, ['smm', 'approve']);
  assert.equal(code, 1);
  assert.match(err.join('\n'), /challenge point 1 has no answer/);
  assert.equal(statusOf(paths[0]), 'draft');
});

test('approval covers every draft task in the group, and leaves the rest alone', () => {
  const { root, cfg, paths } = setup({
    brief: BRIEF,
    challenge: {
      verdict: 'QUESTION',
      points: [{ q: 'Why keep the old signature?', answer: 'drop it' }],
    },
  });
  const { code } = call(cfg, ['smm', 'approve']);
  assert.equal(code, 0);
  assert.deepEqual(paths.map(statusOf), ['approved', 'approved', 'blocked']);
  const stored = JSON.parse(readFileSync(join(root, WORK_DIR, 'smm.json'), 'utf8'));
  assert.match(stored.brief.approved, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(stored.stage, 'build');
  assert.equal(stored.slug, undefined);
  const log = readFileSync(join(root, cfg.log), 'utf8');
  assert.equal(log.match(/"event":"spec"/g).length, 2);
});

test('a question raised during the build shows on the card with what it holds, until answered', () => {
  const raised = [
    {
      task: '024',
      from: 'reviewer',
      q: 'Replace post_save?',
      evidence: 'notify_planning.py:5',
      affects: ['025'],
      answer: null,
    },
  ];
  const { cfg, root } = setup({ brief: BRIEF, raised });
  const text = call(cfg, ['smm']).out.join('\n');
  assert.match(text, /raised {5}r1\. Replace post_save\? {3}\(reviewer on 024\)/);
  assert.match(text, /holds 025/);
  assert.match(text, /→ unanswered/);

  assert.equal(call(cfg, ['smm', 'answer', 'r1', 'yes,', 'replace', 'it']).code, 0);
  const stored = JSON.parse(readFileSync(join(root, WORK_DIR, 'smm.json'), 'utf8'));
  assert.equal(stored.raised[0].answer, 'yes, replace it');
  assert.equal(call(cfg, ['smm', 'answer', 'r2', 'x']).code, 1);
});

test('order puts the named tasks first and keeps the rest after them', () => {
  const { cfg, root } = setup({ brief: BRIEF });
  assert.equal(call(cfg, ['smm', 'order', '026,025']).code, 0);
  const stored = JSON.parse(readFileSync(join(root, WORK_DIR, 'smm.json'), 'utf8'));
  assert.deepEqual(stored.order, ['026', '025', '024']);
  assert.equal(call(cfg, ['smm', 'order', '099']).code, 1);
});

test('a pilot must be one of the group and not finished, and none clears it', () => {
  const { cfg, root } = setup({ brief: BRIEF });
  const read = () => JSON.parse(readFileSync(join(root, WORK_DIR, 'smm.json'), 'utf8'));
  assert.equal(call(cfg, ['smm', 'pilot', '025']).code, 0);
  assert.equal(read().pilot, '025');
  assert.match(call(cfg, ['smm']).out.join('\n'), /025 {2}draft .* ★ pilot/);
  assert.equal(call(cfg, ['smm', 'pilot', '099']).code, 1);
  assert.equal(call(cfg, ['smm', 'pilot', 'none']).code, 0);
  assert.equal(read().pilot, undefined);
});

test('the group view carries what the pit wall needs, and why it cannot be approved yet', () => {
  const view = groupView({
    slug: 'smm',
    title: 'SMM',
    brief: { ...BRIEF },
    pilot: 24,
    raised: [{ task: '024', q: 'Replace?', answer: null }],
  });
  assert.equal(view.shape, 'replace');
  assert.equal(view.pilot, '24');
  assert.equal(view.raised[0].ref, 'r1');
  assert.deepEqual(view.problems, [
    'no challenge: run crew-challenger, or record {"skipped": "<why>"}',
  ]);
});
