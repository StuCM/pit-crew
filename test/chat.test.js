import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readState } from '../src/lib/wall.js';
import { config, sandbox, task, writeTask } from './helpers.js';

// Stands in for claude: echoes whether it was resumed, and does to the files what the message asks.
const FAKE = `#!/usr/bin/env node
const { writeFileSync, appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
const msg = require('node:fs').readFileSync(0, 'utf8');
const resumed = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : 'none';
if (msg.includes('fix it')) appendFileSync('.claude/tasks/007-thing.md', 'Edited by the agent.\\n');
if (msg.includes('stray')) {
  appendFileSync('src/a.ts', 'stray\\n');
  writeFileSync('new.txt', 'stray\\n');
  appendFileSync('.claude/tasks/008-other.md', 'stray\\n');
}
const reply = 'resumed ' + resumed + '\\n\\n\\u0060\\u0060\\u0060replace\\nold: Body text\\nnew: Better text\\n\\u0060\\u0060\\u0060\\n';
process.stdout.write(JSON.stringify({ result: reply, session_id: 's-1' }));
`;

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

const repo = () => {
  const root = sandbox();
  sh(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), '.claude/\n');
  execFileSync('mkdir', ['-p', join(root, 'src')]);
  writeFileSync(join(root, 'src', 'a.ts'), 'a\n');
  sh(root, 'add', '-A');
  sh(root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  writeTask(root, '007-thing.md', task({ status: 'draft' }));
  writeTask(root, '008-other.md', task({ status: 'draft' }).replace('id: 007', 'id: 008'));
  writeFileSync(join(root, 'claude'), FAKE, { mode: 0o755 });
  process.env.CREW_CLAUDE = join(root, 'claude');
  return root;
};

const chat = async (root, args, input) => {
  const { run } = await import('../src/commands/chat.js');
  const out = [];
  const log = console.log;
  console.log = (line) => out.push(line);
  try {
    const code = await run(config(root), args, input);
    return { code, out: JSON.parse(out.at(-1)) };
  } finally {
    console.log = log;
  }
};

test('the second message resumes the first one session, and turns are kept in wall.json', async () => {
  const root = repo();
  const first = await chat(root, ['007'], 'what does this do?');
  assert.equal(first.code, 0);
  assert.match(first.out.text, /^resumed none/);
  assert.equal(readState(root).chat['007'].session, 's-1');
  const second = await chat(root, ['007'], 'and then?');
  assert.match(second.out.text, /^resumed s-1/);
  const history = await chat(root, ['007', '--history']);
  assert.deepEqual(
    history.out.map((t) => [t.who, t.text.split('\n')[0]]),
    [
      ['you', 'what does this do?'],
      ['planner', 'resumed none'],
      ['you', 'and then?'],
      ['planner', 'resumed s-1'],
    ],
  );
});

test('replace blocks come back as suggestions, and an edit to the spec is kept and flagged', async () => {
  const root = repo();
  const { out } = await chat(root, ['007'], 'just fix it');
  assert.deepEqual(out.suggestions, [{ old: 'Body text', new: 'Better text' }]);
  assert.equal(out.edited, true);
  assert.deepEqual(out.reverted, []);
  assert.match(
    readFileSync(join(root, '.claude/tasks/007-thing.md'), 'utf8'),
    /Edited by the agent/,
  );
  assert.equal((await chat(root, ['007'], 'a question')).out.edited, false);
});

test('a change to any file but the spec is reverted and reported; another spec is reported', async () => {
  const root = repo();
  writeFileSync(join(root, 'src', 'a.ts'), 'mine, uncommitted\n');
  const { out } = await chat(root, ['007'], 'stray');
  assert.deepEqual(out.reverted.sort(), ['new.txt', 'src/a.ts']);
  assert.deepEqual(out.otherSpecs, ['.claude/tasks/008-other.md']);
  assert.equal(readFileSync(join(root, 'src', 'a.ts'), 'utf8'), 'mine, uncommitted\n');
  assert.equal(existsSync(join(root, 'new.txt')), false);
  assert.equal(out.edited, false);
});
