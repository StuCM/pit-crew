import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, suggest } from '../src/commands/changes.js';
import { readState, WORK_DIR } from '../src/lib/wall.js';
import { config, sandbox, task, writeTask } from './helpers.js';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const grouped = (id, slug, file) =>
  task({ files: [file] })
    .replace('id: 007', `id: ${id}`)
    .replace('crew/007-thing', `crew/${id}-${slug}`)
    .replace('files:', 'work: smm\nfiles:');

// Two tasks in one group, each with a commit on its own branch; 007's worktree is here, 008's is not.
const fixture = () => {
  const root = sandbox();
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), 'one\ntwo\n');
  writeFileSync(join(root, 'src', 'b.ts'), 'helper()\n');
  writeTask(root, '007-thing.md', grouped('007', 'thing', 'src/a.ts'));
  writeTask(root, '008-other.md', grouped('008', 'other', 'src/b.ts'));
  sh(root, 'add', '-A');
  sh(root, 'commit', '-qm', 'base');
  const tree = `${root}-007`;
  sh(root, 'worktree', 'add', '-q', '-b', 'crew/007-thing', tree);
  appendFileSync(join(tree, 'src', 'a.ts'), 'helper()\n');
  sh(tree, 'commit', '-qam', 'feat: call the helper');
  appendFileSync(join(tree, 'src', 'a.ts'), 'uncommitted\n');
  sh(root, 'switch', '-qc', 'crew/008-other');
  appendFileSync(join(root, 'src', 'b.ts'), 'more()\n');
  sh(root, 'commit', '-qam', 'feat: more');
  sh(root, 'switch', '-q', 'main');
  mkdirSync(join(root, WORK_DIR), { recursive: true });
  writeFileSync(join(root, WORK_DIR, 'smm.json'), JSON.stringify({ title: 'SMM' }));
  return { root, tree, cfg: config(root, { baseBranch: 'main' }) };
};

const json = (cfg, fn, args) => {
  const out = [];
  const { log, error } = console;
  console.log = (line) => out.push(line);
  console.error = () => {};
  try {
    const code = fn(cfg, args);
    return {
      code,
      out: out.at(-1) && (out.at(-1).startsWith('{') ? JSON.parse(out.at(-1)) : out.at(-1)),
    };
  } finally {
    Object.assign(console, { log, error });
  }
};

test("a group shows every task's files and commits, each tagged with its task", () => {
  const { cfg } = fixture();
  const { code, out } = json(cfg, run, ['smm']);
  assert.equal(code, 0);
  assert.equal(out.kind, 'group');
  assert.deepEqual(out.files.map((f) => `${f.task} ${f.path}`).sort(), [
    '007 src/a.ts',
    '008 src/b.ts',
  ]);
  assert.deepEqual(out.commits.map((c) => c.subject).sort(), [
    'feat: call the helper',
    'feat: more',
  ]);
  assert.deepEqual(out.suggestions, []);
});

test('a file reads from the worktree when it is here, uncommitted lines included, else the branch', () => {
  const { cfg } = fixture();
  assert.deepEqual(json(cfg, run, ['7', '--file', 'src/a.ts']).out.lines.slice(0, 4), [
    'one',
    'two',
    'helper()',
    'uncommitted',
  ]);
  assert.deepEqual(json(cfg, run, ['smm', '--file', 'src/b.ts']).out, {
    path: 'src/b.ts',
    task: '008',
    lines: ['helper()', 'more()', ''],
  });
  assert.equal(json(cfg, run, ['7', '--file', 'src/none.ts']).code, 1);
});

test('search runs on the branches, not the checkout, and one commit shows its own diff', () => {
  const { cfg, root } = fixture();
  const { out } = json(cfg, run, ['smm', '--grep', 'helper()']);
  assert.deepEqual(
    out.hits.map((h) => `${h.task} ${h.path}:${h.line}`),
    ['007 src/a.ts:3', '007 src/b.ts:1'],
  );
  const sha = sh(root, 'rev-parse', 'crew/008-other');
  const commit = json(cfg, run, ['smm', '--commit', sha]).out;
  assert.equal(commit.subject, 'feat: more');
  assert.deepEqual(
    commit.files.map((f) => f.path),
    ['src/b.ts'],
  );
});

test('a suggestion is aimed at the commit that wrote its line, and counted on the changes', () => {
  const { cfg } = fixture();
  assert.equal(json(cfg, suggest, ['8', 'src/b.ts', '2', 'use', 'the', 'helper']).code, 0);
  const [item] = readState(cfg.root).suggestions;
  assert.equal(item.task, '008');
  assert.equal(item.quote, 'more()');
  assert.equal(item.note, 'use the helper');
  assert.equal(item.target.kind, 'fixup');
  assert.equal(item.target.subject, 'feat: more');
  assert.equal(json(cfg, run, ['smm']).out.suggestions.length, 1);
  assert.equal(json(cfg, suggest, ['8', 'src/b.ts', '2']).code, 2);
});
