// The projects one `crew serve` shows. Every `crew serve` adds its repository
// here, so a second one joins the server already running instead of fighting
// it for the port — one tab for everything in flight on this machine.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { CONFIG_PATH } from './config.js';

export const registryPath = () =>
  join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'crew', 'projects.json');

const read = (path) => {
  try {
    const list = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const slug = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'project';

/**
 * Every registered repository that still has a crew config, each with a key
 * that is stable, unique and safe in a URL. The page only ever sends a key,
 * so a browser can never name a directory the registry did not.
 */
export const projects = (path = registryPath()) => {
  const seen = new Map();
  return read(path)
    .filter((p) => p?.root && existsSync(join(p.root, CONFIG_PATH)))
    .map((p) => {
      const base = slug(p.name || basename(p.root));
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return {
        key: n === 1 ? base : `${base}-${n}`,
        name: p.name || basename(p.root),
        root: p.root,
      };
    });
};

/** Add a repository, once. Returns its key. */
export const register = (root, name, path = registryPath()) => {
  const list = read(path).filter((p) => p?.root && p.root !== root);
  list.push({ root, name: name || basename(root) });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(list, null, 2)}\n`);
  return projects(path).find((p) => p.root === root)?.key ?? null;
};
