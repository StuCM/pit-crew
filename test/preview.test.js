import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/commands/preview.js';
import { globToRegex } from '../src/lib/preview.js';
import { WORK_DIR } from '../src/lib/wall.js';
import { config, sandbox, task, writeTask } from './helpers.js';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const quietly = (fn) => {
  const out = [];
  const err = [];
  const { log, error } = console;
  console.log = (line) => out.push(line);
  console.error = (line) => err.push(line);
  try {
    return { code: fn(), out: out.join('\n'), err: err.join('\n') };
  } finally {
    Object.assign(console, { log, error });
  }
};

const taskFor = (id, slug, file) =>
  task({ status: 'done', files: [file] })
    .replace('id: 007', `id: ${id}`)
    .replace('crew/007-thing', `crew/${id}-${slug}`)
    .replace('files:', 'work: smm\nfiles:') + '\n## Review rounds\n';

// main with an app and a settings file the committed code runs as is; task 007
// changes app.txt over two commits, 008 changes lib.txt. The overlay adds a
// .env and patches settings, as a different stack would need.
const fixture = () => {
  const root = sandbox();
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  writeFileSync(join(root, 'app.txt'), 'one\ntwo\nthree\n');
  writeFileSync(join(root, 'lib.txt'), 'lib\n');
  writeFileSync(join(root, 'settings.py'), 'DEBUG = False\n');
  writeTask(root, '007-thing.md', taskFor('007', 'thing', 'app.txt'));
  writeTask(root, '008-other.md', taskFor('008', 'other', 'lib.txt'));
  sh(root, 'add', '-A');
  sh(root, 'commit', '-qm', 'base');

  sh(root, 'switch', '-qc', 'crew/007-thing');
  writeFileSync(join(root, 'app.txt'), 'one\nTWO\nthree\n');
  sh(root, 'commit', '-qam', 'feat: shout two');
  writeFileSync(join(root, 'app.txt'), 'one\nTWO\nthree\nfour\n');
  sh(root, 'commit', '-qam', 'feat: add four');
  sh(root, 'switch', '-q', 'main');
  sh(root, 'switch', '-qc', 'crew/008-other');
  writeFileSync(join(root, 'lib.txt'), 'lib\nmore\n');
  sh(root, 'commit', '-qam', 'feat: more lib');
  sh(root, 'switch', '-q', 'main');

  const overlay = `${root}-overlay`;
  mkdirSync(overlay);
  writeFileSync(join(overlay, '.env'), 'PROJECT_NAME=x\n');
  writeFileSync(
    join(overlay, 'patch.diff'),
    'diff --git a/settings.py b/settings.py\n--- a/settings.py\n+++ b/settings.py\n@@ -1 +1,2 @@\n DEBUG = False\n+from toolkit import *\n',
  );
  const flag = `${root}-built`;
  mkdirSync(join(root, WORK_DIR), { recursive: true });
  writeFileSync(
    join(root, WORK_DIR, 'smm.json'),
    JSON.stringify({ title: 'SMM', order: ['007', '008'] }),
  );
  const dir = `${root}-preview`;
  const cfg = config(root, {
    baseBranch: 'main',
    preview: {
      dir,
      start: 'docker compose up',
      overlay,
      afterSwitch: [{ when: '**/*.txt', run: `echo ran >> ${JSON.stringify(flag)}` }],
    },
  });
  return { root, dir, flag, cfg };
};

const read = (path) => readFileSync(path, 'utf8');

test('globs match the way afterSwitch writes them', () => {
  assert.ok(globToRegex('**/*.{js,vue}').test('src/a/b.vue'));
  assert.ok(globToRegex('**/*.{js,vue}').test('b.js'));
  assert.ok(!globToRegex('*.js').test('src/b.js'));
  assert.ok(globToRegex('coral/media/**').test('coral/media/js/x.js'));
});

test('the preview runs the overlay over whatever it shows, and runs the steps a switch needs', () => {
  const { dir, flag, cfg } = fixture();
  const made = quietly(() => run(cfg, ['init']));
  assert.equal(made.code, 0, made.err);
  assert.match(made.out, /docker compose up/);
  assert.equal(read(join(dir, '.env')), 'PROJECT_NAME=x\n');
  assert.equal(read(join(dir, 'settings.py')), 'DEBUG = False\nfrom toolkit import *\n');

  const shown = quietly(() => run(cfg, ['7']));
  assert.equal(shown.code, 0, shown.err);
  assert.equal(sh(dir, 'rev-parse', 'HEAD'), sh(cfg.root, 'rev-parse', 'crew/007-thing'));
  assert.equal(read(join(dir, 'app.txt')), 'one\nTWO\nthree\nfour\n');
  assert.match(read(join(dir, 'settings.py')), /from toolkit/);
  assert.equal(read(flag), 'ran\n');

  const status = JSON.parse(quietly(() => run(cfg, ['status', '--json'])).out);
  assert.deepEqual(status.edits, [], 'the overlay is not an edit');
  assert.equal(status.state.id, '007');
});

test('an edit made while trying a task is folded into the commit that wrote the line', () => {
  const { root, dir, cfg } = fixture();
  quietly(() => run(cfg, ['init']));
  quietly(() => run(cfg, ['7']));
  writeFileSync(join(dir, 'app.txt'), 'one\nTwo\nthree\nfour\n');

  const blocked = quietly(() => run(cfg, ['main']));
  assert.equal(blocked.code, 1);
  assert.match(blocked.err, /edits of its own \(app\.txt\) — keep or drop/);

  const kept = quietly(() => run(cfg, ['keep']));
  assert.equal(kept.code, 0, kept.err);
  assert.match(kept.out, /kept app\.txt on 007, folded into its commits/);
  const log = sh(root, 'log', '--format=%s', 'main..crew/007-thing').split('\n');
  assert.deepEqual(log, ['feat: add four', 'feat: shout two'], 'no fixup! commit is left');
  assert.equal(sh(root, 'show', 'crew/007-thing:app.txt'), 'one\nTwo\nthree\nfour');
  assert.match(
    read(join(root, '.claude', 'tasks', '007-thing.md')),
    /Hand edit from the preview, not reviewed: app\.txt/,
  );

  assert.equal(sh(dir, 'rev-parse', 'HEAD'), sh(root, 'rev-parse', 'crew/007-thing'));
  assert.deepEqual(JSON.parse(quietly(() => run(cfg, ['status', '--json'])).out).edits, []);
  assert.match(read(join(dir, 'settings.py')), /from toolkit/);
});

test('drop throws the edits away and keeps the overlay', () => {
  const { dir, cfg } = fixture();
  quietly(() => run(cfg, ['init']));
  quietly(() => run(cfg, ['7']));
  writeFileSync(join(dir, 'app.txt'), 'scratch\n');
  writeFileSync(join(dir, 'new.txt'), 'scratch\n');
  assert.equal(quietly(() => run(cfg, ['drop'])).code, 0);
  assert.equal(read(join(dir, 'app.txt')), 'one\nTWO\nthree\nfour\n');
  assert.equal(existsSync(join(dir, 'new.txt')), false);
  assert.equal(read(join(dir, '.env')), 'PROJECT_NAME=x\n');
});

test('a group preview merges its branches, and an edit goes to the task that changed the file', () => {
  const { root, dir, cfg } = fixture();
  quietly(() => run(cfg, ['init']));
  const shown = quietly(() => run(cfg, ['group', 'smm']));
  assert.equal(shown.code, 0, shown.err);
  assert.equal(read(join(dir, 'app.txt')), 'one\nTWO\nthree\nfour\n');
  assert.equal(read(join(dir, 'lib.txt')), 'lib\nmore\n');

  writeFileSync(join(dir, 'lib.txt'), 'lib\nmore!\n');
  writeFileSync(join(dir, 'notes.txt'), 'todo\n');
  const unclear = quietly(() => run(cfg, ['keep']));
  assert.equal(unclear.code, 1);
  assert.match(unclear.err, /notes\.txt \(no task changed it\) — say with --to/);

  rmSync(join(dir, 'notes.txt'));
  const kept = quietly(() => run(cfg, ['keep']));
  assert.equal(kept.code, 0, kept.err);
  assert.equal(sh(root, 'show', 'crew/008-other:lib.txt'), 'lib\nmore!');
  assert.equal(sh(root, 'log', '--format=%s', 'main..crew/008-other'), 'feat: more lib');
});

test('keep refuses while the task is still being built', () => {
  const { root, dir, cfg } = fixture();
  quietly(() => run(cfg, ['init']));
  quietly(() => run(cfg, ['7']));
  // A worker's status lives in its worktree's copy of the task file, as dispatch leaves it.
  const tree = `${root}-007`;
  sh(root, 'worktree', 'add', '-q', tree, 'crew/007-thing');
  const path = join(tree, '.claude', 'tasks', '007-thing.md');
  writeFileSync(path, read(path).replace('status: done', 'status: building'));
  writeFileSync(join(dir, 'app.txt'), 'x\n');
  const r = quietly(() => run(cfg, ['keep']));
  assert.equal(r.code, 1);
  assert.match(r.err, /007 is still being built or reviewed/);
  assert.equal(read(join(dir, 'app.txt')), 'x\n', 'the edit is left where it was');
});

test('an edit to the lines the overlay patches is refused, not folded into a task', () => {
  const { dir, cfg } = fixture();
  quietly(() => run(cfg, ['init']));
  quietly(() => run(cfg, ['7']));
  writeFileSync(join(dir, 'settings.py'), 'DEBUG = True\nfrom toolkit import *\n');
  const r = quietly(() => run(cfg, ['keep']));
  assert.equal(r.code, 1);
  assert.match(r.err, /touch the lines the overlay's patch\.diff changes/);
});

test("with the task's worktree here, keep folds the edit there and notes it in that copy of the task", () => {
  const { root, dir, cfg } = fixture();
  const tree = `${root}-007`;
  sh(root, 'worktree', 'add', '-q', tree, 'crew/007-thing');
  quietly(() => run(cfg, ['init']));
  quietly(() => run(cfg, ['7']));
  writeFileSync(join(dir, 'app.txt'), 'one\nTWO\nthree\nfour\nfive\n');
  const kept = quietly(() => run(cfg, ['keep']));
  assert.equal(kept.code, 0, kept.err);
  assert.equal(read(join(tree, 'app.txt')), 'one\nTWO\nthree\nfour\nfive\n');
  assert.deepEqual(sh(root, 'log', '--format=%s', 'main..crew/007-thing').split('\n'), [
    'feat: add four',
    'feat: shout two',
  ]);
  assert.match(read(join(tree, '.claude', 'tasks', '007-thing.md')), /Hand edit from the preview/);
});

test('status reads the edits without writing, so a running stack is not reloaded by a poll', () => {
  const { dir, cfg } = fixture();
  quietly(() => run(cfg, ['init']));
  quietly(() => run(cfg, ['7']));
  const settings = join(dir, 'settings.py');
  const before = statSync(settings).mtimeMs;
  assert.deepEqual(JSON.parse(quietly(() => run(cfg, ['status', '--json'])).out).edits, []);
  writeFileSync(settings, 'DEBUG = True\nfrom toolkit import *\n');
  writeFileSync(join(dir, 'app.txt'), 'x\n');
  const after = statSync(settings).mtimeMs;
  const edits = JSON.parse(quietly(() => run(cfg, ['status', '--json'])).out).edits.map(
    (e) => e.path,
  );
  assert.deepEqual(edits.sort(), ['app.txt', 'settings.py']);
  assert.equal(statSync(settings).mtimeMs, after, 'status wrote nothing');
  assert.ok(after >= before);
});
