// One piece of work, as a group of tasks: the decision card a person reads in
// thirty seconds, and the approval that covers every task in it at once.
//
// Thirty specs approved one by one are thirty skims. The mistakes that cost a
// whole group — patching around a function that should be replaced, taking a
// remark made while thinking aloud as a decision — sit above any one spec, so
// the gate sits there too.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { worktrees } from '../lib/changes.js';
import { statuses } from '../lib/config.js';
import { readTasks, setField } from '../lib/task.js';
import { readWorks, WORK_DIR } from '../lib/wall.js';
import { run as logEvent } from './log.js';
import { run as renderBoard, waitReason } from './board.js';

export const SHAPES = ['replace', 'extend', 'wrap', 'reuse', 'new'];

const USAGE = `usage: crew work                  every piece of work, with its tasks
       crew work <slug>           its decision card and tasks
       crew work <slug> approve   approve the card and every draft task in it
       crew work <slug> answer <c1|r1> <answer…>   the person's answer to a challenge point or a raised question`;

/**
 * The checkout that holds the real work files. A worker runs in a worktree
 * whose .claude/ is a copy, and a question it raises must reach the person.
 */
export const mainRoot = (cfg) => worktrees(cfg.root)[0]?.path ?? cfg.root;

export const workPath = (root, slug) => join(root, WORK_DIR, `${slug}.json`);

/** Write a work file back, without what readWorks adds from its name and time. */
export const saveWork = (root, work) => {
  const stored = { ...work };
  delete stored.slug;
  delete stored.updated;
  writeFileSync(workPath(root, work.slug), `${JSON.stringify(stored, null, 2)}\n`);
};

/** Questions raised during the build that the person has not answered, holding these task ids. */
export const openRaised = (work) => list(work?.raised).filter((r) => !r.answer);

/** The open raised question holding back a task, if any: it asked, or it is named as affected. */
export const heldBy = (work, id) =>
  openRaised(work).find((r) => r.task === id || list(r.affects).map(String).includes(id)) ?? null;

const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/** Its tasks, in the work file's `order:` first, then by id. */
export const tasksOf = (cfg, work) => {
  const mine = readTasks(join(cfg.root, cfg.tasksDir)).filter((t) => t.meta.work === work.slug);
  const order = list(work.order).map(String);
  const at = (t) => (order.includes(t.id) ? order.indexOf(t.id) : order.length);
  return mine.sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
};

/** What stops the card being approved; empty when nothing does. */
export const problems = (work) => {
  const brief = work.brief ?? {};
  const out = [];
  if (!SHAPES.includes(brief.shape)) out.push(`brief.shape is not one of ${SHAPES.join(', ')}`);
  if (brief.shape && brief.shape !== 'new' && !list(brief.target).length)
    out.push(
      `brief.target: what is being ${brief.shape === 'reuse' ? 'reused' : brief.shape + 'd'}, by path`,
    );
  if (!brief.direction) out.push('brief.direction is empty');
  if (!list(brief.rejected).length)
    out.push('brief.rejected: name the alternative not taken, and why — or "none considered"');

  const challenge = work.challenge;
  if (!challenge) out.push('no challenge: run crew-challenger, or record {"skipped": "<why>"}');
  else if (!challenge.skipped) {
    list(challenge.points).forEach((point, i) => {
      if (!point.answer) out.push(`challenge point ${i + 1} has no answer from the person`);
    });
  }
  return out;
};

const where = (ref) =>
  typeof ref === 'string'
    ? ref
    : `${ref.path}${ref.line ? `:${ref.line}` : ''}${ref.name ? ` ${ref.name}` : ''}`;

/** The decision card, as lines. */
export const card = (cfg, work, tasks) => {
  const brief = work.brief ?? {};
  const known = statuses(cfg);
  const out = [work.title ?? work.slug, ''];
  const row = (label, text) => out.push(`  ${label.padEnd(10)} ${text}`);
  const rows = (label, items, fmt = (x) => x) =>
    list(items).forEach((item, i) => row(i ? '' : label, fmt(item)));

  row('shape', [brief.shape ?? '?', ...list(brief.target).map(where)].join('  '));
  row('direction', brief.direction ?? '?');
  rows('not', brief.rejected, (r) => (typeof r === 'string' ? r : `${r.option} — ${r.why}`));
  rows('from you', brief.decided);
  rows('exploring', brief.exploring, (x) => `${x}   (said, not decided)`);

  const challenge = work.challenge;
  if (challenge?.skipped) row('challenge', `skipped — ${challenge.skipped}`);
  else if (challenge) {
    const points = list(challenge.points);
    const open = points.filter((p) => !p.answer).length;
    row(
      'challenge',
      `${challenge.verdict ?? '?'}${points.length ? `, ${points.length} point(s), ${open} unanswered` : ''}`,
    );
    points.forEach((p, i) => {
      out.push(`    ${i + 1}. ${p.q}`);
      if (p.evidence) out.push(`       ${p.evidence}`);
      out.push(`       → ${p.answer ?? 'unanswered'}`);
    });
  } else row('challenge', 'not run');
  if (brief.approved) row('approved', brief.approved);

  // Raised after approval, by a reviewer who found the approach itself in doubt.
  list(work.raised).forEach((r, i) => {
    row(i ? '' : 'raised', `r${i + 1}. ${r.q}   (${r.from ?? 'reviewer'} on ${r.task})`);
    if (r.evidence) out.push(`             ${r.evidence}`);
    if (list(r.affects).length) out.push(`             holds ${list(r.affects).join(', ')}`);
    out.push(`             → ${r.answer ?? 'unanswered'}`);
  });

  out.push('');
  if (!tasks.length) out.push('  no tasks carry this work: yet');
  for (const t of tasks) {
    const status = t.meta.status ?? '?';
    const why =
      known[status]?.waitsOnUser && status !== 'draft' ? ` — ${waitReason(t, known)}` : '';
    out.push(`  ${t.id}  ${status.padEnd(9)} ${t.title}${why}`);
  }
  return out;
};

const answer = (cfg, work, [ref, ...words]) => {
  const text = words.join(' ').trim();
  const at = /^([cr])(\d+)$/.exec(ref ?? '');
  if (!at || !text) {
    console.error(USAGE);
    return 2;
  }
  const items = at[1] === 'c' ? list(work.challenge?.points) : list(work.raised);
  const item = items[Number(at[2]) - 1];
  if (!item) {
    console.error(`work: ${work.slug} has no ${ref}`);
    return 1;
  }
  item.answer = text;
  saveWork(cfg.root, work);
  console.log(`work: ${ref} answered`);
  if (at[1] === 'r') {
    console.log(`  if the approach still holds: npx crew task ${item.task} sendback`);
    console.log('  if it changed: update the brief and the affected tasks first');
  }
  return 0;
};

export const run = (cfg, [slug, verb, ...rest] = []) => {
  const works = readWorks(cfg.root);
  if (!slug) {
    if (!works.length) console.log('work: none recorded in ' + WORK_DIR);
    for (const work of works) {
      const tasks = tasksOf(cfg, work);
      const state = work.brief?.approved ? 'approved' : work.brief ? 'briefed' : 'no brief';
      console.log(`${work.slug.padEnd(28)} ${String(tasks.length).padStart(3)} task(s)  ${state}`);
    }
    return 0;
  }

  const work = works.find((w) => w.slug === slug);
  if (!work) {
    console.error(`work: no ${join(WORK_DIR, `${slug}.json`)}`);
    return 1;
  }
  const tasks = tasksOf(cfg, work);

  if (!verb) {
    console.log(card(cfg, work, tasks).join('\n'));
    const missing = problems(work);
    if (missing.length && !work.brief?.approved) {
      console.log('\n  not ready to approve:');
      for (const line of missing) console.log(`    - ${line}`);
    }
    return 0;
  }

  if (verb === 'answer') return answer(cfg, work, rest);
  if (verb !== 'approve') {
    console.error(USAGE);
    return 2;
  }
  const missing = problems(work);
  if (missing.length) {
    console.error(`work: ${slug} is not ready to approve:`);
    for (const line of missing) console.error(`  - ${line}`);
    return 1;
  }
  const drafts = tasks.filter((t) => t.meta.status === 'draft');
  for (const t of drafts) {
    setField(t.path, 'status', 'approved');
    logEvent(cfg, [t.path, 'spec']);
  }
  work.brief = { ...work.brief, approved: new Date().toISOString().slice(0, 10) };
  work.stage = 'build';
  saveWork(cfg.root, work);
  renderBoard(cfg);
  console.log(`work: ${slug} approved, ${drafts.length} task(s) with it`);
  return 0;
};
