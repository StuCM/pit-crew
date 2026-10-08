import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tooOldForMods } from '../src/commands/doctor.js';

test('tooOldForMods compares against 2.1.286', () => {
  assert.equal(tooOldForMods('2.1.285 (Claude Code)'), true);
  assert.equal(tooOldForMods('2.0.999 (Claude Code)'), true);
  assert.equal(tooOldForMods('2.1.286 (Claude Code)\n'), false);
  assert.equal(tooOldForMods('2.1.293 (Claude Code)'), false);
  assert.equal(tooOldForMods('3.0.0'), false);
  assert.equal(tooOldForMods('garbage'), null);
  assert.equal(tooOldForMods(''), null);
});
