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
//
// They are *concepts*, not resources, and concepts carry `label` where a
// resource carries `name`. Asking for name returned nothing from 234 of them,
// silently, for as long as this command has existed.
export const CONCEPT_QUERY = (type, limit) => `SELECT ?label ?desc ?why WHERE {
  GRAPH ?g { ?n rdf:type mem:${type} ; mem:label ?label .
             OPTIONAL { ?n mem:description ?desc }
             OPTIONAL { ?n mem:rationale ?why } } } LIMIT ${limit}`;

// What the project *is*, and nothing else. `recall --depth 1` looks like the
// right call and is not: a worked-in project accumulates hundreds of links, and
// coral-arches returned 648KB from 816 of them. The neighbours are what
// `traps`, `decisions` and `files` are for, each of them bounded.
const PROJECT_QUERY = (project) => `SELECT ?p ?o WHERE {
  GRAPH ?g { ?n rdf:type mem:Project ; mem:name ${literal(project)} ; ?p ?o } }`;

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

// The CLI prints resource IRIs with the ontology prefix folded in —
// `mem:resource/<uuid>` — which is not a legal prefixed name once it carries a
// slash, so it goes back into a query as a full IRI. Anything that is not
// shaped like one of the store's own IRIs is refused rather than quoted.
const MEM = 'https://memory.claude.local/ontology#';
const LINKS = '<https://memory.claude.local/graph/links>';
const SCHEMA = '<https://memory.claude.local/graph/schema>';

export const iriRef = (value) => {
  const iri = value.startsWith('mem:') ? MEM + value.slice(4) : value;
  return /^https:\/\/memory\.claude\.local\/[\w#/-]+$/.test(iri) ? `<${iri}>` : null;
};

// What each end of a chain shows: enough to judge relevance, and the anchor so
// a scout can go and check the claim against the code.
const DESCRIBE = `?type ; mem:name|mem:label ?name .
             OPTIONAL { ?other mem:description ?desc }
             OPTIONAL { ?other mem:anchorPath ?anchor }
             OPTIONAL { ?other mem:sourceContext ?ctx }
             FILTER NOT EXISTS { ?other mem:invalidated ?inv }`;

/**
 * Entry points for a chain: live nodes whose name or description holds every
 * word of the text. Every word rather than the phrase, because the person
 * says "concepts turned to references" and the Pattern says "reference
 * datatype conversion".
 */
export const SEED_QUERY = (text, limit) => {
  const words = text.split(/\s+/).filter(Boolean);
  const hay = `LCASE(CONCAT(STR(?name), ' ', STR(COALESCE(?desc, ''))))`;
  return `SELECT ?other ?type ?name ?desc ?anchor ?ctx WHERE {
  GRAPH ?g { ?other rdf:type ${DESCRIBE} }
  FILTER(?g != ${LINKS} && ?g != ${SCHEMA} && ?type != mem:Project)
  FILTER( ${words.map((w) => `CONTAINS(${hay}, LCASE(${literal(w)}))`).join(' && ')} ) }
LIMIT ${limit}`;
};

/**
 * Every open link touching these nodes, and what sits at the other end. The
 * same shape the store's own recall uses, minus the full property dump that
 * made `recall --depth 2` unreadable.
 */
export const NEIGHBOUR_QUERY = (
  refs,
) => `SELECT ?me ?other ?rel ?dir ?type ?name ?desc ?anchor ?ctx WHERE {
  VALUES ?me { ${refs.join(' ')} }
  GRAPH ${LINKS} { ?l rdf:type mem:CrossLink ; mem:linkSource ?s ; mem:linkTarget ?t ; mem:linkRelation ?rel .
             FILTER NOT EXISTS { ?l mem:linkValidUntil ?end }
             FILTER NOT EXISTS { ?l mem:linkInvalidatedAt ?gone } }
  FILTER(?s = ?me || ?t = ?me)
  BIND(IF(?s = ?me, ?t, ?s) AS ?other)
  BIND(IF(?s = ?me, 'out', 'in') AS ?dir)
  GRAPH ?g { ?other rdf:type ${DESCRIBE} }
  FILTER(?g != ${LINKS} && ?g != ${SCHEMA}) }`;

// A node linked to more than this is a hub — a Project, or a Technology like
// Arches that half the store points at. Walking through one is how a two-hop
// recall on coral-arches became 648KB, so a hub is named and not followed.
export const FANOUT = 25;
const SEEDS = 6;

const query = (sparql) => {
  let out;
  try {
    out = execFileSync(CLI, ['query', sparql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
  if (out === 'No results.') return [];
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
};

const projectOf = (ctx) => ctx?.split('__')[0];

const line = (node) => {
  const where = [projectOf(node.ctx), node.anchor].filter(Boolean).join(' @ ');
  return `${node.type.replace(/^mem:/, '')} "${node.name}"${where ? `  [${where}]` : ''}`;
};

const clip = (text, n = 200) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/**
 * Follow the links out from whatever matches the text, `depth` hops, and
 * render the chains as an indented tree. Lines, so it can be tested without
 * a store; `ask` runs one SPARQL query and returns its rows, or null.
 */
export const chain = (text, { depth = 2, limit = 40 } = {}, ask = query) => {
  const seeds = ask(SEED_QUERY(text, SEEDS));
  if (seeds === null) return ['graph: query failed (the store may be empty)'];
  if (!seeds.length) return [`graph: nothing matches "${text}"`];

  const nodes = new Map();
  const children = new Map();
  const hubs = [];
  const add = (row, parent) => {
    if (nodes.has(row.other) || nodes.size >= limit) return false;
    nodes.set(row.other, { ...row, desc: row.desc ?? '' });
    if (parent) children.set(parent, [...(children.get(parent) ?? []), row.other]);
    return true;
  };

  const roots = [];
  for (const row of seeds) if (add(row)) roots.push(row.other);

  let frontier = roots;
  let failed = false;
  for (let hop = 0; hop < depth && frontier.length && nodes.size < limit; hop++) {
    const refs = frontier.map(iriRef).filter(Boolean);
    const rows = refs.length ? ask(NEIGHBOUR_QUERY(refs)) : [];
    if (rows === null) {
      failed = true;
      break;
    }

    const byNode = new Map();
    for (const row of rows) {
      const seen = byNode.get(row.me) ?? new Map();
      seen.set(row.other, row);
      byNode.set(row.me, seen);
    }

    const next = [];
    for (const me of frontier) {
      const found = [...(byNode.get(me)?.values() ?? [])];
      if (found.length > FANOUT) {
        hubs.push(`${nodes.get(me).name} (${found.length} links)`);
        continue;
      }
      for (const row of found) {
        if (row.type === 'mem:Project') continue;
        if (add(row, me)) next.push(row.other);
      }
    }
    frontier = next;
  }

  const out = [];
  const render = (iri, indent) => {
    const node = nodes.get(iri);
    const edge = node.rel ? (node.dir === 'out' ? `${node.rel} → ` : `← ${node.rel} `) : '';
    out.push(`${indent}${edge}${line(node)}`);
    if (node.desc) out.push(`${indent}    ${clip(node.desc.replace(/\s+/g, ' '))}`);
    for (const child of children.get(iri) ?? []) render(child, `${indent}  `);
  };
  for (const root of roots) render(root, '');
  // Each of these means the chain could have gone further. They are printed
  // so the reader can say it needed more, not guess that it had everything.
  if (hubs.length) out.push('', `not followed, too many links: ${hubs.join(', ')}`);
  if (failed) out.push('', 'stopped early: a query failed part-way, so the chain is incomplete');
  else if (frontier.length && nodes.size < limit) {
    const names = frontier.slice(0, 5).map((iri) => nodes.get(iri).name);
    const more = frontier.length > 5 ? ` and ${frontier.length - 5} more` : '';
    out.push('', `not expanded, depth ${depth} reached: ${names.join(', ')}${more}`);
  }
  if (nodes.size >= limit)
    out.push('', `stopped at ${limit} nodes — narrow the text or pass --limit=N`);
  return out;
};

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
      return call(['query', PROJECT_QUERY(project)]);
    case 'prefs':
      return call(['query', CONCEPT_QUERY('Preference', limit)]);
    case 'constraints':
      return call(['query', CONCEPT_QUERY('Constraint', limit)]);
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
    case 'chain': {
      const text = rest.filter((arg) => !arg.startsWith('--')).join(' ');
      if (!text) {
        console.error('usage: crew graph chain <text> [--depth=1..3] [--limit=N]');
        return 2;
      }
      const asked = rest.find((arg) => arg.startsWith('--depth='));
      const depth = Math.min(Math.max(Number(asked?.slice('--depth='.length)) || 2, 1), 3);
      console.log(chain(text, { depth, limit }).join('\n'));
      return 0;
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
        'usage: crew graph {prime|prefs|constraints|traps|decisions|' +
          'files <path...>|find <text>|chain <text>|raw <sparql>} [--limit=N]',
      );
      return 2;
  }
};
