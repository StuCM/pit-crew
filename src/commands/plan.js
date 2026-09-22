// The slice of the plan maps that bears on one task, printed for a worker.
//
// Workers stay hermetic: this reads JSON files in the repo, never the memory
// graph and never the network. The spec already carries this part's purpose
// and boundaries; what it cannot carry is the neighbourhood — what this part
// connects to and what those neighbours are explicitly not responsible for.
// That is where a worker drifts, so that is what this prints.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readTask } from '../lib/task.js';

const LAYERS = ['feature', 'architecture', 'brainstorm'];

const fail = (message) => {
  const error = new Error(message);
  error.crew = true;
  throw error;
};

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    fail(`${path} is not readable JSON: ${cause.message}`);
  }
};

/** The manifest's maps, loaded, with paths resolved relative to the manifest. */
export const readPlan = (cfg, manifestPath) => {
  const path = manifestPath || join(cfg.root, cfg.plansDir, 'plan.json');
  if (!existsSync(path)) return null;

  const plan = readJson(path);
  const maps = [];
  for (const layer of LAYERS) {
    const entry = plan.maps?.[layer];
    if (!entry?.file) continue;
    const file = resolve(dirname(path), entry.file);
    maps.push({
      layer,
      file,
      artifact: entry.artifact || null,
      map: existsSync(file) ? readJson(file) : null,
    });
  }
  return { path, name: plan.name || '(unnamed plan)', maps };
};

// Feature and architecture maps hold a flat `parts`; a brainstorm map nests
// its nodes inside themes. One accessor so nothing downstream has to know.
const partsOf = (entry) =>
  entry.map?.parts || (entry.map?.themes || []).flatMap((theme) => theme.nodes || []);

const findPart = (plan, id) => {
  for (const entry of plan.maps) {
    const part = partsOf(entry).find((p) => p.id === id);
    if (part) return { entry, part };
  }
  return null;
};

const label = (entry, id) => partsOf(entry).find((p) => p.id === id)?.label || id;

const bullets = (heading, items) => {
  if (!items?.length) return;
  console.log(`\n  ${heading}`);
  for (const item of items) console.log(`    - ${item}`);
};

const symbolLine = (s) => {
  const where = s.file ? `${s.file}${s.line ? `:${s.line}` : ''}` : '(new)';
  const mark = s.verified ? '' : '  [unverified]';
  const why = s.change || s.note || '';
  return `    ${(s.use || '?').padEnd(8)} ${s.name}  ${where}${mark}${why ? `\n             ${why}` : ''}`;
};

const CHANGING = new Set(['modify', 'replace', 'add', 'extend', 'override']);

const showPart = (plan, entry, part) => {
  console.log(`${part.label}  [${part.status || '?'}]  in the ${entry.layer} map — ${plan.name}`);
  if (part.purpose) console.log(`\n  Purpose     ${part.purpose}`);
  const why = part.why_here || part.why_split;
  if (why) console.log(`  Why here    ${why}`);
  if (part.where?.length) console.log(`  Where       ${part.where.join(', ')}`);
  if (entry.artifact) console.log(`  Diagram     ${entry.artifact}`);

  bullets('Not this part’s job:', part.not);

  const surface = part.surface || [];
  const changing = surface.filter((s) => CHANGING.has(s.use));
  const using = surface.filter((s) => !CHANGING.has(s.use));
  if (changing.length) {
    console.log('\n  Changing:');
    for (const s of changing) console.log(symbolLine(s));
  }
  if (using.length) {
    console.log('\n  Using — do not change these:');
    for (const s of using) console.log(symbolLine(s));
  }

  const edges = (entry.map?.edges || []).filter((e) => e.from === part.id || e.to === part.id);
  if (edges.length) {
    console.log('\n  Connected to:');
    for (const edge of edges) {
      const out = edge.from === part.id;
      const other = out ? edge.to : edge.from;
      const arrow = out ? '→' : '←';
      const name = `${edge.kind || 'link'} "${edge.label || ''}"`.replace(' ""', '');
      console.log(`    ${arrow} ${name.padEnd(24)} ${label(entry, other)}`);
      if (edge.note) console.log(`      ${edge.note}`);
    }
  }

  // The gate in agent-tasks refuses to emit a task for a part with open
  // questions, so one here means the spec was written around the gate or the
  // map moved on afterwards. Either way the worker must not decide it in code.
  if (part.open?.length) {
    console.log('\n  OPEN QUESTIONS ON THIS PART — do not answer these in code:');
    for (const q of part.open) console.log(`    ? ${q}`);
    console.log('\n  Set status: blocked and say which one you hit.');
  }
};

const showPlan = (plan) => {
  console.log(`${plan.name}  (${plan.path})`);
  for (const entry of plan.maps) {
    const parts = partsOf(entry);
    console.log(
      `  ${entry.layer.padEnd(13)} ${parts.length} parts${entry.map ? '' : '  [MISSING]'}`,
    );
    if (entry.artifact) console.log(`  ${''.padEnd(13)} ${entry.artifact}`);
  }
};

export const run = (cfg, args) => {
  const plan = readPlan(cfg);
  if (!plan) {
    console.log(
      `no plan at ${join(cfg.plansDir, 'plan.json')} — this project has no planning layer.\n` +
        'Run /pit-crew-planning:plan-init to add one, or carry on without it.',
    );
    return 0;
  }

  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    showPlan(plan);
    return 0;
  }

  // A task file, or a bare part id — the worker has the first, the
  // orchestrator writing the spec usually has only the second.
  const id = existsSync(target) ? readTask(target).meta.part : target;
  if (!id) {
    console.log(`${target} has no \`part:\` in its frontmatter — nothing to look up.`);
    return 0;
  }

  const hit = findPart(plan, id);
  if (!hit) fail(`no part "${id}" in any map of ${plan.path}`);
  showPart(plan, hit.entry, hit.part);
  return 0;
};
