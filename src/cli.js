#!/usr/bin/env node
// One entry point. Everything crew knows how to do without a model.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_PATH, loadConfig } from './lib/config.js';
import { repoRoot } from './lib/git.js';

// The two commands git calls. They run wherever git runs them, so they are
// the only ones allowed to do nothing at all.
const HOOKS = new Set(['commit-msg', 'pre-commit']);

const USAGE = `crew — a task loop for agents

  crew init                 install crew into this repository
  crew init --global        install the git hooks once, for every repository
  crew init --list          the sections, and how to leave one out
  crew doctor               is this installation actually wired up?

  crew spec-template        print the task template, for a new spec
  crew graph <what>         read the memory graph: prime, prefs, traps,
                            decisions, files <path...>, find <text>
  crew collisions <task>    unmerged branches already touching its files:
  crew preflight [env]      what this machine can and cannot prove
  crew plan [task|part]     the plan map slice bearing on a task

  crew gate <task>          prepare + scope + verify, then stamp the commit
  crew gate --check <task>  has the gate passed on the code that is here?
  crew scope <task> [base]  changed files against the spec's files:
  crew review <task>        open a review round, refusing one past the limit
  crew board                render BOARD.md from the task files
  crew log <task> <event>   append one line to the cost log

  crew commit-msg <file>    the commit convention (git hook)
  crew pre-commit           staged-file format and lint (git hook)
  crew hook scope           PreToolUse: refuse a write outside files:
`;

// Loaded on demand: a git hook should not parse nine modules to check a
// subject line, and `init` has to run before there is a config to load.
const COMMANDS = {
  'commit-msg': () => import('./commands/commit-msg.js'),
  'pre-commit': () => import('./commands/pre-commit.js'),
  scope: () => import('./commands/scope-check.js'),
  board: () => import('./commands/board.js'),
  preflight: () => import('./commands/preflight.js'),
  gate: () => import('./commands/gate.js'),
  doctor: () => import('./commands/doctor.js'),
  log: () => import('./commands/log.js'),
  review: () => import('./commands/review.js'),
  graph: () => import('./commands/graph.js'),
  plan: () => import('./commands/plan.js'),
  init: () => import('./commands/init.js'),
  'spec-template': () => import('./commands/init.js').then((m) => ({ run: m.template })),
};

const main = async (argv) => {
  let [name, ...args] = argv;

  // `--help` anywhere means "tell me, do not do it". It used to be read only
  // in the first position, so `crew init --help` fell through to init and
  // wrote into a repository the reader was still deciding about.
  if (!name || name === 'help' || argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return name ? 0 : 2;
  }

  // Aliases for the two shapes that read better as their own verb.
  if (name === 'collisions') [name, args] = ['preflight', ['collisions', ...args]];
  if (name === 'hook') [name, args] = [`hook-${args[0] || ''}`, args.slice(1)];

  if (name === 'hook-scope') {
    // A hook must never break the session it is advising. Anything unexpected
    // means no decision, which leaves the normal permission flow in charge.
    try {
      const root = repoRoot();
      if (!root) return 0;
      const { run } = await import('./commands/hook-scope.js');
      return run(loadConfig(root), args);
    } catch {
      return 0;
    }
  }

  const load = COMMANDS[name];
  if (!load) {
    console.error(`crew: unknown command "${name}"\n`);
    console.log(USAGE);
    return 2;
  }

  const { run } = await load();

  if (name === 'init') {
    // The machine-wide install and the section list are about this machine,
    // not about any one repository, so neither needs to be inside one.
    if (args.includes('--global') || args.includes('--list')) return run(null, args);
    const target = repoRoot();
    if (!target) {
      console.error('crew: not a git work tree');
      return 2;
    }
    return run(target, args);
  }

  const root = repoRoot();
  if (!root) {
    console.error('crew: not a git work tree');
    return 2;
  }

  try {
    return run(loadConfig(root), args);
  } catch (error) {
    // A git hook runs in every repository once core.hooksPath is global.
    // In one that does not use crew there is nothing to enforce, and a hook
    // that fails there is a hook the user turns off.
    if (error.crew && HOOKS.has(name) && !existsSync(join(root, CONFIG_PATH))) return 0;
    if (error.crew) {
      console.error(`crew: ${error.message}`);
      return 2;
    }
    throw error;
  }
};

// `process.exit` here truncated every output larger than a pipe buffer:
// stdout is asynchronous when it is a pipe, so `crew graph prime` delivered
// exactly 64KiB of a 648KB answer to a caller and nothing reported a fault.
// Setting the code and returning lets node exit once the stream has drained.
main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
