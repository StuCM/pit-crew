import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.js';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const hook = (cwd, input = '') =>
  execFileSync('node', [CLI, 'hook', 'session'], { cwd, encoding: 'utf8', input });
const say = (cwd, id) =>
  JSON.parse(hook(cwd, JSON.stringify({ session_id: id }))).hookSpecificOutput.additionalContext;
const claim = (cwd, id) => execFileSync('node', [CLI, 'orchestrator', 'claim', id], { cwd });

const repo = (crew) => {
  const root = sandbox();
  sh(root, 'init', '-q', '-b', 'main');
  if (crew) {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'crew.config.json'), '{"project":"t","verify":"true"}');
  }
  return root;
};

test('a crew repository starts its session told to route work through crew-spec', () => {
  const out = JSON.parse(hook(repo(true)));
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /crew:crew-spec/);
});

test('a worker on its task branch, and a repository without crew, hear nothing', () => {
  const root = repo(true);
  sh(root, 'checkout', '-q', '-b', 'crew/007-thing');
  assert.equal(hook(root), '');
  assert.equal(hook(repo(false)), '');
});

test('the orchestrator, a side chat and an unclaimed repo each hear their own role', () => {
  const root = repo(true);
  assert.match(say(root, 'a'), /No orchestrator is set.*Your session id is a\./);
  claim(root, 'a');
  assert.match(say(root, 'a'), /You are the orchestrator for t, titled Orchestrator · t/);
  assert.match(
    say(root, 'b'),
    /Orchestrator · t is the orchestrator.*You are a side chat.*Your session id is b\./,
  );
});

test('empty or invalid stdin still gets the no-orchestrator text', () => {
  const root = repo(true);
  for (const input of ['', 'not json']) {
    assert.match(
      JSON.parse(hook(root, input)).hookSpecificOutput.additionalContext,
      /No orchestrator is set/,
    );
  }
});
