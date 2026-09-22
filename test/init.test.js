import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chosen } from '../src/commands/init.js';

const names = (args, opts) => chosen(args, opts).map((s) => s.name);

test('the default set is everything not marked off', () => {
  const got = names([]);
  assert.deepEqual(got, ['config', 'brief', 'tasks', 'schema', 'hooks', 'scope', 'plans']);
  // The task template is only wanted by a project that means to edit it.
  assert.ok(!got.includes('template'));
});

test('--without drops sections and --only replaces the set', () => {
  assert.deepEqual(names(['--without=hooks,scope']), [
    'config',
    'brief',
    'tasks',
    'schema',
    'plans',
  ]);
  assert.deepEqual(names(['--only=config,brief']), ['config', 'brief']);
});

test('--only can ask for a section that is off by default', () => {
  assert.deepEqual(names(['--only=template']), ['template']);
});

// The whole point of --global: a repo should not get a second copy of hooks
// that a machine-wide hooksPath already delivers.
test('a global hooks path drops the hooks section, and nothing else', () => {
  const got = names([], { globalHooks: true });
  assert.ok(!got.includes('hooks'));
  assert.deepEqual(got, ['config', 'brief', 'tasks', 'schema', 'scope', 'plans']);
});

test('--only overrides the global-hooks skip, for a repo that wants its own', () => {
  assert.deepEqual(names(['--only=hooks'], { globalHooks: true }), ['hooks']);
});

test('a misspelled section is refused, and the message lists the real ones', () => {
  assert.throws(
    () => chosen(['--without=hook']),
    (error) => {
      assert.match(error.message, /unknown section\(s\): hook/);
      assert.match(error.message, /known: config, brief, tasks, schema, hooks, scope, plans/);
      return true;
    },
  );
});

test('the old --hook spelling still asks for the scope section', () => {
  assert.ok(names(['--hook']).includes('scope'));
  assert.ok(names(['--hook', '--without=scope']).includes('scope'));
});
