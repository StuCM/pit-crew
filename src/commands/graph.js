// Read-only access to the memory graph, for briefing a task.
//
// Writes are MCP-only and orchestrator-only by design, so this is safe to run
// anywhere. If the CLI is not installed it says so and exits 0 — the loop must
// never stall because the memory layer is missing.

import { execFileSync } from 'node:child_process';
import { onPath } from './preflight.js';

const CLI = process.env.CREW_GRAPH_CLI || 'claude-memory-graph';

const call = (args) => {
  try {
    process.stdout.write(
      execFileSync(CLI, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
    );
    return 0;
  } catch {
    console.log('graph: query failed (the store may be empty)');
    return 0;
  }
};

// The store is one graph for every project on the machine, so an unscoped
// listing hands a coral task the traps from a TV app. There is no triple
// linking a Pattern to a Project — relations are not stored that way — but
// `sourceContext` is the context file it was distilled from, and that file is
// named `<project>__<date>.md`. It is on 1732 of 1755 Patterns, which makes
// the prefix the only project key the store actually has.
export const SCOPED = (type, project, limit) => `SELECT ?name ?desc ?when WHERE {
  GRAPH ?g { ?n rdf:type mem:${type} ; mem:name ?name ; mem:sourceContext ?sc .
             OPTIONAL { ?n mem:description ?desc }
             OPTIONAL { ?n mem:updatedAt ?when }
             FILTER( STRSTARTS(STR(?sc), ${literal(`${project}__`)}) ) } }
ORDER BY DESC(?when) LIMIT ${limit}`;

// Preferences are the one type that is deliberately cross-project — how this
// person wants work done travels with them — so scoping them to a repository
// would hide exactly the ones worth carrying into a spec.
const TYPE_QUERY = (type, limit) => `SELECT ?name ?desc WHERE {
  GRAPH ?g { ?n rdf:type mem:${type} ; mem:name ?name .
             OPTIONAL { ?n mem:description ?desc } } } LIMIT ${limit}`;

/**
 * Patterns anchored at a path that one of these files sits under. anchorPath
 * is repo-relative and may be a directory, which is why the file is tested
 * against the anchor and not the other way round.
 */
export const FILES_QUERY = (files, limit) => `SELECT ?name ?desc ?ap WHERE {
  GRAPH ?g { ?n rdf:type mem:Pattern ; mem:name ?name ; mem:anchorPath ?ap .
             OPTIONAL { ?n mem:description ?desc }
             FILTER( ${files.map((f) => `STRSTARTS(${literal(f)}, STR(?ap))`).join(' || ')} ) } }
LIMIT ${limit}`;

// The shell script this replaces interpolated the search text straight into a
// FILTER, where a quote broke the query and a well-chosen one rewrote it. The
// text is still the only way to ask the question, so it is escaped as a SPARQL
// string literal rather than trusted.
const literal = (text) =>
  `'${text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/[\r\n]/g, ' ')}'`;

const FIND_QUERY = (text, limit) => `SELECT ?type ?name ?desc WHERE {
  GRAPH ?g { ?n rdf:type ?type ; mem:name ?name .
             OPTIONAL { ?n mem:description ?desc }
             FILTER( CONTAINS(LCASE(STR(?name)), LCASE(${literal(text)}))
                  || CONTAINS(LCASE(STR(COALESCE(?desc,''))), LCASE(${literal(text)})) ) } }
LIMIT ${limit}`;

export const run = (cfg, [command = 'prime', ...rest]) => {
  if (!onPath(CLI)) {
    console.log(`graph: ${CLI} is not on PATH — no graph context available.`);
    if (cfg.decisionsFile)
      console.log(`graph: rely on ${cfg.decisionsFile} and CLAUDE.md for this task.`);
    return 0;
  }

  const project = cfg.graphProject || cfg.project;
  const given = rest.find((arg) => arg.startsWith('--limit='));
  const limit = Number(given?.slice('--limit='.length)) || 40;

  switch (command) {
    // Depth 1. Depth 2 walks into every neighbour's neighbours and has
    // returned over half a megabyte from a mature store — a briefing nobody
    // can read is the same as no briefing, and it costs the whole budget.
    case 'prime':
      return call(['recall', 'Project', project, '--depth', '1']);
    case 'prefs':
      return call(['query', TYPE_QUERY('Preference', limit)]);
    case 'traps':
      return call(['query', SCOPED('Pattern', project, limit)]);
    case 'decisions':
      return call(['query', SCOPED('Decision', project, limit)]);
    case 'files': {
      const paths = rest.filter((arg) => !arg.startsWith('--'));
      if (!paths.length) {
        console.error('usage: crew graph files <path> [path...]');
        return 2;
      }
      return call(['query', FILES_QUERY(paths, limit)]);
    }
    case 'find': {
      const text = rest.filter((arg) => !arg.startsWith('--')).join(' ');
      if (!text) {
        console.error('usage: crew graph find <text>');
        return 2;
      }
      return call(['query', FIND_QUERY(text, limit)]);
    }
    case 'raw': {
      if (!rest.length) {
        console.error('usage: crew graph raw <sparql>');
        return 2;
      }
      return call(['query', rest.join(' ')]);
    }
    default:
      console.error(
        'usage: crew graph {prime|prefs|traps|decisions|files <path...>|find <text>|raw <sparql>} [--limit=N]',
      );
      return 2;
  }
};
