import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MANIFESTS, mismatches, sync } from '../scripts/version.js';
import { sandbox } from './helpers.js';

const repo = () => {
  const root = sandbox();
  for (const file of ['package.json', ...MANIFESTS]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(file, join(root, file));
  }
  return root;
};

test('a release tag must match package.json and every plugin manifest', () => {
  const root = repo();
  const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  assert.deepEqual(mismatches(root, current), []);
  const wrong = new Set(mismatches(root, '99.0.0').map(([file]) => file));
  assert.ok(wrong.has('package.json'));
  assert.ok(wrong.has('.claude-plugin/marketplace.json'));
});

test('syncing copies the version into the manifests and changes nothing else', () => {
  const root = repo();
  const before = readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8');
  sync(root, '1.2.3-beta.1');
  const after = readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8');
  assert.equal(after, before.replaceAll(/"version": "[^"]*"/g, '"version": "1.2.3-beta.1"'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ ...pkg, version: '1.2.3-beta.1' }));
  assert.deepEqual(mismatches(root, '1.2.3-beta.1'), []);
});
