#!/usr/bin/env node
// One version, in four files. npm bumps package.json; the plugin manifests
// are what `/plugin update` compares, so a release that bumps only npm is
// one no Claude Code install ever sees.
//
//   node scripts/version.js            copy package.json's version into the others
//   node scripts/version.js --check X  fail unless all four say X

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFESTS = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'planning/.claude-plugin/plugin.json',
];

const VERSION = /("version"\s*:\s*")([^"]*)(")/g;

/**
 * Every version in every file, as [file, version] pairs. package.json is
 * read as JSON: it also has a `"version"` npm script, which a pattern would
 * take for a version.
 */
export const versions = (root) => [
  ['package.json', JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version],
  ...MANIFESTS.flatMap((file) =>
    [...readFileSync(join(root, file), 'utf8').matchAll(VERSION)].map((m) => [file, m[2]]),
  ),
];

/** Set every manifest to `version`, editing only the version strings. */
export const sync = (root, version) => {
  for (const file of MANIFESTS) {
    const path = join(root, file);
    writeFileSync(path, readFileSync(path, 'utf8').replace(VERSION, `$1${version}$3`));
  }
};

/** The files that disagree with `version`; empty when the release is consistent. */
export const mismatches = (root, version) => versions(root).filter(([, v]) => v !== version);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const at = process.argv.indexOf('--check');
  if (at === -1) {
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    sync(root, version);
    console.log(`version: ${version} in package.json and ${MANIFESTS.length} manifests`);
  } else {
    const wanted = process.argv[at + 1];
    const wrong = mismatches(root, wanted);
    for (const [file, v] of wrong)
      console.error(`version: ${file} says ${v}, the tag says ${wanted}`);
    if (!wanted || wrong.length) process.exitCode = 1;
    else console.log(`version: all ${versions(root).length} entries say ${wanted}`);
  }
}
