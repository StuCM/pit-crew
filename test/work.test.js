import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { problems, run } from '../src/commands/work.js';
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
