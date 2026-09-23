import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projects, register } from '../src/lib/registry.js';
import { sandbox } from './helpers.js';

const crewRepo = (name) => {
  const root = join(sandbox(), name);
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude', 'crew.config.json'), '{}');
  return root;
};

test('two projects share one page, each with its own key, and registering twice is once', () => {
  const file = join(sandbox(), 'projects.json');
  const a = crewRepo('coral-arches');
  const b = crewRepo('reflex');
  assert.equal(register(a, 'coral-arches', file), 'coral-arches');
  assert.equal(register(b, 'Reflex', file), 'reflex');
  register(a, 'coral-arches', file);
  assert.deepEqual(
    projects(file)
      .map((p) => p.key)
      .sort(),
    ['coral-arches', 'reflex'],
  );
});

test('two repositories with one name get different keys, and a removed one drops out', () => {
  const file = join(sandbox(), 'projects.json');
  const a = crewRepo('app');
  const b = crewRepo('app');
  register(a, 'app', file);
  register(b, 'app', file);
  assert.deepEqual(
    projects(file).map((p) => p.key),
    ['app', 'app-2'],
  );
  writeFileSync(join(a, '.claude', 'crew.config.json'), '{}');
  register(join(sandbox(), 'gone'), 'gone', file);
  assert.equal(
    projects(file).some((p) => p.name === 'gone'),
    false,
  );
});
