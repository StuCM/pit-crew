// Read-only access to the memory graph, for briefing a task.
//
// Writes are MCP-only and orchestrator-only by design, so this is safe to run
// anywhere. If the CLI is not installed it says so and exits 0 — the loop must
// never stall because the memory layer is missing.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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

// Project -> hub -> plans, each with its decisions (and what superseded them) and constraints.
export const TREE_QUERY = (
  project,
) => `SELECT ?plan ?destination ?decision ?rationale ?supersededBy ?clabel ?cdesc WHERE {
  GRAPH ?gp { ?proj rdf:type mem:Project ; mem:name ${literal(project)} ; mem:hasConcept ?hub }
  GRAPH ?gh { ?hub mem:label ${literal(`${project} planning`)} }
  GRAPH ?gt { ?t rdf:type mem:Task ; mem:name ?plan ; mem:partOf ?proj ; mem:hasConcept ?hub .
              OPTIONAL { ?t mem:destination ?destination }
              OPTIONAL { ?t mem:hasConstraint ?c .
                         GRAPH ?gc { ?c mem:label ?clabel . OPTIONAL { ?c mem:description ?cdesc } } } }
  OPTIONAL { GRAPH ?gd { ?d mem:affects ?t ; mem:name ?decision .
                         OPTIONAL { ?d mem:rationale ?rationale }
                         OPTIONAL { ?s mem:supersedes ?d . GRAPH ?gs { ?s mem:name ?supersededBy } } } } }`;

// Fold the query's cross-product rows into one entry per plan.
export const foldTree = (project, rows) => {
  const plans = new Map();
  for (const row of rows) {
    if (!plans.has(row.plan))
      plans.set(row.plan, {
        name: row.plan,
        destination: row.destination ?? null,
        decisions: [],
        outOfScope: [],
      });
    const plan = plans.get(row.plan);
    if (row.decision && !plan.decisions.some((d) => d.name === row.decision))
      plan.decisions.push({
        name: row.decision,
        rationale: row.rationale ?? null,
        supersededBy: row.supersededBy ?? null,
      });
    if (row.clabel && !plan.outOfScope.some((c) => c.label === row.clabel))
      plan.outOfScope.push({ label: row.clabel, description: row.cdesc ?? null });
  }
  return { project, hub: `${project} planning`, plans: [...plans.values()] };
};

const treeText = (tree) => {
  const lines = [tree.project, `  ${tree.hub}`];
  for (const plan of tree.plans) {
    lines.push(`    ${plan.name}${plan.destination ? ` — ${plan.destination}` : ''}`);
    for (const d of plan.decisions)
      lines.push(`      ${d.name}${d.supersededBy ? ` (superseded by ${d.supersededBy})` : ''}`);
    for (const c of plan.outOfScope) lines.push(`      ✗ ${c.label}`);
  }
  return lines.join('\n');
};

const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );

const STYLE = `
:root { --bg: #fff; --fg: #1d2330; --line: #8a93a6; --box: #eef1f7; --muted: #6b7384; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #14171f; --fg: #e4e8f1; --line: #6b7384; --box: #232937; --muted: #9aa3b5; }
}
body { background: var(--bg); color: var(--fg); font: 15px/1.4 system-ui, sans-serif; margin: 24px; }
.plans { display: flex; gap: 32px; align-items: flex-start; flex-wrap: wrap; }
.plan { min-width: 220px; max-width: 320px; }
.dest { color: var(--muted); margin: 0 0 12px; }
.decision { background: var(--box); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; position: relative; }
.decision + .decision { margin-top: 20px; }
.decision + .decision::before { content: ""; position: absolute; left: 50%; top: -20px; height: 20px; border-left: 2px solid var(--line); }
.decision.old { opacity: 0.5; }
.why, .by { color: var(--muted); font-size: 13px; }
.scope { margin-top: 16px; }
.scope s { display: block; }
`;

// One self-contained page: a column per plan, decisions stacked top to bottom.
export const treeHtml = (tree) => {
  const columns = tree.plans.map((plan) => {
    const decisions = plan.decisions.map(
      (d) =>
        `<div class="decision${d.supersededBy ? ' old' : ''}"><strong>${esc(d.name)}</strong>` +
        (d.rationale ? `<div class="why">${esc(d.rationale)}</div>` : '') +
        (d.supersededBy ? `<div class="by">superseded by ${esc(d.supersededBy)}</div>` : '') +
        '</div>',
    );
    const scope = plan.outOfScope.map(
      (c) =>
        `<s>${esc(c.label)}</s>` +
        (c.description ? `<span class="why">${esc(c.description)}</span>` : ''),
    );
    return (
      `<section class="plan"><h2>${esc(plan.name)}</h2>` +
      (plan.destination ? `<p class="dest">${esc(plan.destination)}</p>` : '') +
      decisions.join('') +
      (scope.length ? `<div class="scope">${scope.join('')}</div>` : '') +
      '</section>'
    );
  });
  const body = columns.length
    ? `<div class="plans">${columns.join('')}</div>`
    : `<p>No plans in the graph for ${esc(tree.project)}.</p>`;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(tree.hub)}</title><style>${STYLE}</style></head>` +
    `<body><h1>${esc(tree.hub)}</h1>${body}</body></html>\n`
  );
};

const tree = (project, json, htmlFile) => {
  let rows;
  try {
    rows = JSON.parse(
      execFileSync(CLI, ['query', TREE_QUERY(project)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    console.log('graph: query failed (the store may be empty)');
    return 0;
  }
  const result = foldTree(project, rows);
  if (htmlFile) {
    writeFileSync(htmlFile, treeHtml(result));
    console.log(`wrote ${htmlFile}`);
  } else if (json) console.log(JSON.stringify(result, null, 2));
  else if (!result.plans.length) console.log(`No plans in the graph for ${project}.`);
  else console.log(treeText(result));
  return 0;
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
      // The graph ranks each hop's edges against the text and follows only the best.
      return call(['chain', text, `--depth=${depth}`, `--limit=${limit}`]);
    }
    case 'tree': {
      const at = rest.indexOf('--html');
      if (at >= 0 && (!rest[at + 1] || rest[at + 1].startsWith('--'))) {
        console.error('usage: crew graph tree [project] --html <file>');
        return 2;
      }
      const name = rest.find((arg, i) => !arg.startsWith('--') && i !== at + 1) || project;
      return tree(name, rest.includes('--json'), at >= 0 ? rest[at + 1] : null);
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
          'files <path...>|find <text>|chain <text>|tree [project] [--json|--html <file>]|raw <sparql>} [--limit=N]',
      );
      return 2;
  }
};
