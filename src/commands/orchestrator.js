// The repo's one orchestrator chat: a claim file shared by the main checkout and every worktree.

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { git } from '../lib/git.js';

export const claimPath = (cfg) => {
  const common = git(['rev-parse', '--git-common-dir'], cfg.root)?.trim() || '.git';
  const dir = isAbsolute(common) ? common : resolve(cfg.root, common);
  return join(dir, 'crew-orchestrator.json');
};

/** The claim, or null if there is none or it cannot be read. */
export const readClaim = (cfg) => {
  try {
    return JSON.parse(readFileSync(claimPath(cfg), 'utf8'));
  } catch {
    return null;
  }
};

export const run = (cfg, args) => {
  const [verb, id] = args;
  const held = readClaim(cfg);

  if (verb === 'show') {
    console.log(held ? JSON.stringify(held) : 'none');
    return 0;
  }
  if (verb === 'release') {
    rmSync(claimPath(cfg), { force: true });
    return 0;
  }
  if (verb === 'claim' && id) {
    if (held?.session === id) return 0;
    if (held && !args.includes('--force')) {
      console.error(
        `crew: ${held.title} already holds the claim (session ${held.session}); use --force to take over`,
      );
      return 1;
    }
    const claim = {
      session: id,
      title: `Orchestrator · ${cfg.project}`,
      claimed: new Date().toISOString(),
    };
    writeFileSync(claimPath(cfg), `${JSON.stringify(claim)}\n`);
    return 0;
  }
  console.error('usage: crew orchestrator claim <session-id> [--force] | show | release');
  return 2;
};
