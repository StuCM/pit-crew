// Installs crew, in sections.
//
// Two scopes. `--global` puts the git hooks on the machine once, so a
// repository needs nothing but the two files that are actually about it:
// what it is, and the rules a wrong diff can satisfy. Without it, everything
// lands in the repository as before.
//
// Idempotent by rule: anything the project may have edited is written once and
// never overwritten. Only the files crew owns — the schema, the git hooks —
// are refreshed, which is what makes upgrading safe.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const PACKAGE = join(import.meta.dirname, '..', '..');
const REPO_HOOKS = join('.claude', 'crew', 'githooks');

export const globalHooksDir = () =>
  join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'crew', 'githooks');

// A project's own copy wins, so a template edited to suit the repo is not
// quietly replaced by the packaged one on every upgrade.
export const template = (cfg) => {
  const own = join(cfg.root, '.claude', 'crew', 'templates', 'task.md');
  const from = existsSync(own) ? own : join(PACKAGE, 'templates', 'task.md');
  process.stdout.write(readFileSync(from, 'utf8'));
  return 0;
};

const place = (root, from, to, { overwrite = false } = {}) => {
  const target = join(root, to);
  const had = existsSync(target);
  if (had && !overwrite) {
    console.log(`  kept    ${to}`);
    return false;
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(PACKAGE, from), target);
  console.log(`  ${had ? 'updated' : 'wrote  '} ${to}`);
  return true;
};

const gitConfig = (args, cwd) => {
  try {
    return execFileSync('git', ['config', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // git exits 1 when the key is unset, which is the common case, not an error.
    return '';
  }
};

const writeHooks = (dir) => {
  mkdirSync(dir, { recursive: true });
  for (const hook of ['commit-msg', 'pre-commit']) {
    copyFileSync(join(PACKAGE, 'githooks', hook), join(dir, hook));
    chmodSync(join(dir, hook), 0o755);
  }
};

const SCOPE_HOOK = {
  matcher: 'Edit|Write|NotebookEdit',
  hooks: [{ type: 'command', command: 'npx --no-install crew hook scope', timeout: 10 }],
};

/**
 * Adds the scope hook to .claude/settings.json without disturbing anything
 * else in it. Recognised by its command string, so running init twice does
 * not install it twice.
 */
const addScopeHook = (root) => {
  const path = join(root, '.claude', 'settings.json');
  const settings = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};

  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];

  const already = settings.hooks.PreToolUse.some((entry) =>
    (entry.hooks || []).some((hook) => (hook.command || '').includes('crew hook scope')),
  );
  if (already) {
    console.log('  kept    .claude/settings.json (scope hook already present)');
    return;
  }

  settings.hooks.PreToolUse.push(SCOPE_HOOK);
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  console.log('  updated .claude/settings.json (PreToolUse scope hook)');
};

/** Does a hooks path already reach this repository? Then do not write our own. */
const hooksAlreadyServe = (root) => {
  const configured = gitConfig(['--get', 'core.hooksPath'], root);
  if (!configured) return null;
  const dir = resolve(root, configured);
  return existsSync(join(dir, 'commit-msg')) ? dir : null;
};

const installRepoHooks = (root) => {
  const serving = hooksAlreadyServe(root);
  if (serving && resolve(root, REPO_HOOKS) !== serving) {
    console.log(`  kept    core.hooksPath → ${serving}`);
    console.log('          (already reaches this repo; not overriding it)');
    return;
  }

  writeHooks(join(root, REPO_HOOKS));
  console.log(`  wrote   ${REPO_HOOKS}/`);

  if (serving) {
    console.log('  kept    core.hooksPath');
    return;
  }
  const other = gitConfig(['--get', 'core.hooksPath'], root);
  if (other) {
    // Someone else's hooks are installed. Say so rather than taking over.
    console.log(`\n  core.hooksPath is "${other}", leaving it alone.`);
    console.log(`  To use crew's: git config core.hooksPath ${REPO_HOOKS}`);
    return;
  }
  execFileSync('git', ['config', 'core.hooksPath', REPO_HOOKS], { cwd: root });
  console.log('  set     core.hooksPath');
};

const PLANS_DIR = '.claude/plans';

/**
 * Scaffolds the planning layer through the planning plugin's own installer,
 * which is the only thing that knows the manifest's shape, then writes the
 * config key it would otherwise only advise — one command means one command.
 */
const installPlans = (root) => {
  const script = join(PACKAGE, 'planning', 'scripts', 'init_plan.py');
  if (!existsSync(script)) {
    console.log('  skipped plans (the planning plugin is not installed alongside crew)');
    return;
  }

  const done = spawnSync('python3', [script, '--name', root.split('/').pop()], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (done.status !== 0) {
    console.log(`  skipped plans (${(done.stderr || 'init_plan.py failed').trim()})`);
    return;
  }
  // Its advice about crew.config.json is ours to act on, not to repeat.
  for (const line of done.stdout.split('\n')) {
    if (line.startsWith('created') || line.startsWith(PLANS_DIR)) console.log(`  ${line}`);
  }

  const config = join(root, '.claude', 'crew.config.json');
  if (!existsSync(config)) return;
  const raw = JSON.parse(readFileSync(config, 'utf8'));
  if (raw.plansDir === PLANS_DIR) return;
  raw.plansDir = PLANS_DIR;
  writeFileSync(config, `${JSON.stringify(raw, null, 2)}\n`);
  console.log(`  updated .claude/crew.config.json (plansDir)`);
};

// Order matters: this is the order they run and the order `--list` prints.
const SECTIONS = [
  {
    name: 'config',
    what: '.claude/crew.config.json — what this project is, and how to prove it',
    run: (root) => place(root, 'templates/crew.config.json', '.claude/crew.config.json'),
  },
  {
    name: 'brief',
    what: '.claude/crew/project.md — the rules a plausible diff can violate',
    run: (root) => place(root, 'templates/project.md', '.claude/crew/project.md'),
  },
  {
    name: 'tasks',
    what: '.claude/tasks/ — where specs and the board live',
    run: (root) => {
      mkdirSync(join(root, '.claude', 'tasks'), { recursive: true });
      console.log('  ready   .claude/tasks/');
    },
  },
  {
    name: 'schema',
    what: 'a local copy of the config schema, so an editor resolves $schema',
    run: (root) =>
      place(root, 'schema/crew.config.schema.json', '.claude/crew/crew.config.schema.json', {
        overwrite: true,
      }),
  },
  { name: 'hooks', what: 'the git hooks, and core.hooksPath', run: installRepoHooks },
  { name: 'scope', what: 'the PreToolUse scope hook in .claude/settings.json', run: addScopeHook },
  { name: 'plans', what: 'the planning layer: .claude/plans/ and its manifest', run: installPlans },
  {
    name: 'template',
    what: 'a local copy of the task template, to edit for this project',
    off: true,
    run: (root) => place(root, 'templates/task.md', '.claude/crew/templates/task.md'),
  },
];

/** `--without a,b` / `--only a,b`, as a set of section names. */
export const chosen = (args, { globalHooks = false } = {}) => {
  const list = (flag) =>
    args
      .filter((a) => a.startsWith(`${flag}=`))
      .flatMap((a) => a.slice(flag.length + 1).split(','))
      .map((s) => s.trim())
      .filter(Boolean);

  const only = list('--only');
  const without = new Set(list('--without'));

  const unknown = [...only, ...without].filter((n) => !SECTIONS.some((s) => s.name === n));
  if (unknown.length) {
    const error = new Error(
      `unknown section(s): ${unknown.join(', ')}\nknown: ${SECTIONS.map((s) => s.name).join(', ')}`,
    );
    error.crew = true;
    throw error;
  }

  // --hook is the old spelling of the scope section, kept so a documented
  // command line does not start failing.
  if (args.includes('--hook') && !only.length) without.delete('scope');

  return SECTIONS.filter((section) => {
    if (only.length) return only.includes(section.name);
    if (without.has(section.name)) return false;
    // Machine-wide hooks already cover every repo; writing a second copy per
    // repo is the duplication `--global` exists to remove.
    if (section.name === 'hooks' && globalHooks) return false;
    return !section.off;
  });
};

const installGlobal = () => {
  const dir = globalHooksDir();
  console.log(`crew: installing the hooks for every repository, into ${dir}\n`);
  writeHooks(dir);
  console.log('  wrote   commit-msg, pre-commit');

  const current = gitConfig(['--global', '--get', 'core.hooksPath']);
  if (current === dir) {
    console.log('  kept    global core.hooksPath');
  } else if (current) {
    console.log(`\n  global core.hooksPath is "${current}", leaving it alone.`);
    console.log(`  To use crew's: git config --global core.hooksPath ${dir}`);
  } else {
    execFileSync('git', ['config', '--global', 'core.hooksPath', dir]);
    console.log('  set     global core.hooksPath');
  }

  console.log(`
These hooks run in every repository on this machine, so they are built to be
invisible in the ones that do not use crew: no .claude/crew.config.json means
they exit 0 without a word. They also chain to a repo's own .git/hooks, which
a hooksPath would otherwise switch off — husky and friends keep working.

next:  cd <a project> && crew init
`);
  return 0;
};

export const run = (root, args) => {
  if (args.includes('--list')) {
    console.log('crew init sections:\n');
    for (const s of SECTIONS) {
      console.log(`  ${s.name.padEnd(9)} ${s.what}${s.off ? '   [off by default]' : ''}`);
    }
    console.log('\n  crew init --without hooks,scope\n  crew init --only config,brief\n');
    return 0;
  }

  if (args.includes('--global')) return installGlobal();

  const globalHooks = gitConfig(['--global', '--get', 'core.hooksPath']) !== '';
  const sections = chosen(args, { globalHooks });

  console.log(`crew: installing into ${root}`);
  console.log(`      sections: ${sections.map((s) => s.name).join(', ')}\n`);

  for (const section of sections) section.run(root);

  if (globalHooks && !sections.some((s) => s.name === 'hooks')) {
    console.log('  skipped hooks (a global core.hooksPath already covers this repo)');
  }

  console.log(`
next:
  1. edit .claude/crew.config.json — project, verify, environments
  2. write .claude/crew/project.md — the rules that make a wrong diff look right
  3. crew doctor

  crew init --list  shows every section and how to leave one out
`);
  return 0;
};
