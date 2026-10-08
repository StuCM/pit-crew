const PANE = 'crew-wall';
const SPEC_PANE = 'crew-spec';

// Neutrals sampled from the Desktop app (pane border, chrome); accents kept only where they carry meaning.
const C = {
  window: '#F9F9F8',
  border: '#DDDDDD',
  card: '#FFFFFF',
  cardBorder: '#E8E8E6',
  well: '#F3F3F2',
  ink: '#1F1E1C',
  mut: '#6B6A66',
  faint: '#9B9A96',
  clay: '#C6613F',
  amb: '#9A6224',
  vio: '#735DA3',
  blue: '#3E6FA8',
  green: '#47795A',
  gray: '#8F8B83',
  ambBg: '#FAEEDA',
  clayBg: '#FBE9E2',
  vioBg: '#EEEDFE',
};

// 8-point scale in cells: Desktop draws a cell at roughly 8px, so sm is the 16px step.
const S = { xs: 1, sm: 2, md: 3 };

const MODELS = [
  { value: 'opus', label: 'Opus 5.5' },
  { value: 'sonnet', label: 'Sonnet 5.5' },
  { value: 'haiku', label: 'Haiku 4.5' },
];

let board = null; // the last `crew board --json`, for each task's file and status
let boardError = '';
let isLoaded = false;

const loadBoard = async ($) => {
  try {
    const run = await $.process.run(['npx', '--no-install', 'crew', 'board', '--json']);
    if (run.exitCode !== 0) {
      const why = run.stderr.trim().split('\n')[0] || 'exit ' + run.exitCode;
      throw new Error(why);
    }
    board = JSON.parse(run.stdout);
    boardError = '';
    if (!selectedTask()) selected = board.tasks[0]?.id ?? selected;
  } catch (err) {
    boardError = 'Could not read the board: ' + err.message;
  }
  isLoaded = true;
};

const refreshBoard = async ($) => {
  await loadBoard($);
  doc = null;
  $.ui.invalidate('ui.render');
};

const selectedTask = () => board?.tasks.find((t) => t.id === selected);

// Every write goes through the crew CLI, which owns the task files; a refusal is toasted and the view reloaded.
const crew = async ($, args, stdin) => {
  const run = await $.process.run(
    ['npx', '--no-install', 'crew', ...args],
    stdin === undefined ? undefined : { stdin },
  );
  if (run.exitCode !== 0)
    $.ui.toast(run.stderr.trim().split('\n')[0] || 'crew exited ' + run.exitCode);
  await refreshBoard($);
  return run.exitCode === 0;
};

const editSpec = ($, change) => crew($, ['task', selected, 'edit'], JSON.stringify(change));

let selected = '';
// Desktop draws a plain Button's hover itself with no padding prop, so spaces in the label widen it.
const pad = (label) => ' ' + label + ' ';
let log = '';

const select = async ($, id) => {
  selected = id;
  doc = null;
  await $.ui.open({
    id: SPEC_PANE,
    title: id + ' · ' + (selectedTask()?.title ?? ''),
    focus: true,
  });
  $.ui.invalidate('ui.render');
};

// ---- The crew list. Drawing adapted from savvy-progress's agents panel (MIT, © 2026 johnnyvizz).
const SECTIONS = [
  { name: 'Scout', costume: 'astronaut' },
  { name: 'Worker', costume: 'engineer' },
  { name: 'Reviewer', costume: 'detective' },
  { name: 'Done', costume: 'racer' },
];
const SECTION_OF = {
  draft: 'Scout',
  approved: 'Worker',
  building: 'Worker',
  review: 'Reviewer',
  blocked: 'Reviewer',
};

// Tasks by crew role, empty sections dropped; Done keeps every task still waiting on the person and the 5 newest finished.
export const buildSections = ({ statuses, tasks }) => {
  const isFinished = (t) => statuses[t.status]?.terminal;
  return SECTIONS.map(({ name, costume }) => {
    const mine = tasks.filter((t) => (SECTION_OF[t.status] ?? 'Done') === name);
    const finished = mine.filter(isFinished).sort((x, y) => y.id.localeCompare(x.id));
    const shown =
      name === 'Done' ? [...mine.filter((t) => !isFinished(t)), ...finished.slice(0, 5)] : mine;
    return { name, costume, tasks: shown };
  }).filter((section) => section.tasks.length);
};

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif";
const ROW_H = 52;
const SECTION_H = 30;

// Rough advance of system UI text, in em; good enough to size a slot.
const charEm = (ch) => (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Z@%mw]/.test(ch) ? 0.72 : 0.56);
const textWidth = (s, size) => [...s].reduce((w, ch) => w + charEm(ch) * size, 0);

const fitText = (s, size, maxW) => {
  if (textWidth(s, size) <= maxW) return s;
  let out = '';
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break;
    out += ch;
  }
  return out + '…';
};

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.ln{stroke:#e4e4e1}.mk{stroke:#9a9a96}
.pb{fill:#FAEEDA}.pt{fill:#9A6224}.lv{fill:#378ADD}.ok{stroke:#3B9C5F}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.ln{stroke:#333331}.mk{stroke:#7d7d79}
.pb{fill:#3D2E18}.pt{fill:#E8B26A}.lv{fill:#6AA8EE}.ok{stroke:#5CC283}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`;

// Only an in-flight row runs: every crab walks, the engineer's wrench turns, the detective's magnifier sweeps.
const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
@keyframes blink{50%{opacity:.15}}
.c-detective.run .it{animation:scan 1s steps(1) infinite}
.c-detective.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-engineer.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`;

// The crab is pixel art in mid tones, drawn the same in both themes, so its fills stay literal.
const CLAY = '#D97757';
const INK = '#1F1E1D';
const COSTUME_COLOR = {
  astronaut: '#7F77DD',
  engineer: '#BA7517',
  detective: '#D85A30',
  racer: '#1D9E75',
};

// `cls` puts a pixel in a group: `bd` (the default) is the body, `la`/`lb` the leg pairs, anything else a prop.
const stamp = (f, x, y, rows, map, cls) =>
  rows.forEach((row, dy) =>
    [...row].forEach((ch, dx) => {
      if (map[ch]) f(x + dx, y + dy, 1, 1, map[ch], cls);
    }),
  );

const crabBody = (f, armFront = 0, armCls) => {
  f(7, 10, 16, 12, CLAY);
  f(3, 14, 4, 4, CLAY);
  f(23, 14 + armFront, 4, 4, CLAY, armCls);
  f(9, 12, 2, 2, INK);
  f(19, 12, 2, 2, INK);
  f(7, 22, 2, 4, CLAY, 'la');
  f(17, 22, 2, 4, CLAY, 'la');
  f(11, 22, 2, 4, CLAY, 'lb');
  f(21, 22, 2, 4, CLAY, 'lb');
};

const COSTUMES = {
  astronaut: (f, t) => {
    crabBody(f);
    f(6, 7, 18, 1, '#E6E8EE');
    f(5, 8, 1, 14, '#E6E8EE');
    f(24, 8, 1, 14, '#E6E8EE');
    f(6, 22, 18, 1, '#C9CCD2');
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)');
    f(8, 9, 2, 1, '#fff');
    f(8, 10, 1, 2, '#fff');
    f(14, 4, 2, 3, '#C9CCD2');
    f(14, 2, 2, 2, t);
    f(13, 18, 4, 2, t);
    f(27, 3, 1, 3, '#F5C542');
    f(26, 4, 3, 1, '#F5C542');
  },
  detective: (f, t) => {
    crabBody(f, -4, 'it');
    stamp(
      f,
      6,
      3,
      [
        '......bbbbbb......',
        '....bbcbbcbbbb....',
        '...bbbbbbbbbbbb...',
        '..bcbbcbbcbbcbbb..',
        '.bbbbbbbbbbbbbbbb.',
        'dddddddddddddddddd',
      ],
      { b: '#7A4A26', c: '#A0703F', d: '#5A3519' },
    );
    f(6, 9, 18, 1, t);
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it');
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it');
    f(25, 6, 1, 4, '#7A4A26', 'it');
    f(24, 2, 1, 1, '#fff', 'gl');
  },
  engineer: (f, t) => {
    crabBody(f);
    stamp(
      f,
      6,
      4,
      [
        '.....yyyyyyyy.....',
        '...yyyyyhhyyyyy...',
        '..yyyyyyhhyyyyyy..',
        '..yyyyyyhhyyyyyy..',
        '.yyyyyyyhhyyyyyyy.',
        'dddddddddddddddddd',
      ],
      { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' },
    );
    f(13, 5, 4, 2, t);
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it');
  },
  racer: (f, t) => {
    crabBody(f, -4);
    stamp(
      f,
      6,
      5,
      [
        '....rrrrrrrrrr....',
        '..rrrrrrwwrrrrrr..',
        '.rrrrrrrwwrrrrrrr.',
        '.rrrrrrrwwrrrrrrr.',
        '.rrrrrrrwwrrrrrrr.',
        '.kkkkkkkkkkkkkkkkr',
      ],
      { r: t, w: '#F8F6F1', k: INK },
    );
    f(25, 1, 1, 9, '#8E929A');
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK });
  },
};

// Props nest inside `bd` so they ride its bob; the legs stay outside it and step on their own.
const crab = (x, y, costume, isLive) => {
  const groups = new Map([['bd', []]]);
  const f = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, []);
    groups.get(cls).push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`);
  };
  COSTUMES[costume](f, COSTUME_COLOR[costume]);
  const group = (cls) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`;
  const props = [...groups.keys()].filter((k) => k !== 'bd' && k !== 'la' && k !== 'lb');
  const body = `<g class="bd">${groups.get('bd').join('')}${props.map(group).join('')}</g>`;
  return `<g transform="translate(${x},${y}) scale(1.1)" shape-rendering="crispEdges"><g class="c-${costume}${isLive ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`;
};

const statusMark = (x, y, meta) => {
  if (meta.inFlight) return `<circle class="live lv" cx="${x}" cy="${y}" r="3.5"/>`;
  if (meta.terminal)
    return `<path class="ok" d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<circle class="mk" cx="${x}" cy="${y}" r="5" fill="none" stroke-width="1.4"/><path class="mk" d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke-width="1.4" stroke-linecap="round"/>`;
};

const svg = (W, H, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${CRAB_CSS}${body}</svg>`;

const rowSvg = (task, meta, W, costume) => {
  const textW = W - 42 - 24;
  const id = task.id + '  ';
  const title = fitText(task.title, 13, textW - textWidth(id, 13));
  const pillX = 42 + textWidth(task.status, 11) + 10;
  const waiting = meta.waitsOnUser
    ? fitText('⚑ ' + meta.waitsOnUser, 11, Math.max(W - pillX - 40, 20))
    : '';
  const pill = waiting
    ? `<rect class="pb" x="${pillX}" y="27" width="${textWidth(waiting, 11) + 16}" height="16" rx="8"/>
<text class="pt" x="${pillX + 8}" y="39" font-family="${FONT}" font-size="11" font-weight="600">${esc(waiting)}</text>`
    : '';
  return svg(
    W,
    ROW_H,
    `${crab(0, 10, costume, meta.inFlight)}
<text x="42" y="20" font-family="${FONT}" font-size="13" font-weight="600"><tspan class="m">${esc(id)}</tspan><tspan class="t">${esc(title)}</tspan></text>
<text class="s" x="42" y="39" font-family="${FONT}" font-size="11">${esc(task.status)}</text>
${pill}${statusMark(W - 8, 16, meta)}
<line class="ln" x1="0" y1="${ROW_H - 0.5}" x2="${W}" y2="${ROW_H - 0.5}"/>`,
  );
};

const sectionSvg = (title, count, W) =>
  svg(
    W,
    SECTION_H,
    `<text x="0" y="20" font-family="${FONT}" font-size="12" font-weight="600"><tspan class="t">${esc(title)}</tspan><tspan class="m"> · ${count}</tspan></text>`,
  );

// Each row is a keyed Box holding the drawing, with card.js laid over it to take the click an Svg cannot.
const boardList = ({ Box, Text, Svg, Client }, width, surface) => {
  const isDrawn = surface === 'desktop' && Svg;
  const W = Math.max(240, Math.min(900, width * 8 - 8));
  const row = (task, costume) => {
    const meta = board.statuses[task.status] ?? {};
    const waiting = meta.waitsOnUser ? ' · ⚑ ' + meta.waitsOnUser : '';
    return Box({
      key: 'row-' + task.id,
      position: 'relative',
      flexShrink: 0,
      children: [
        isDrawn
          ? Svg({
              source: rowSvg(task, meta, W, costume),
              alt: `${task.id} ${task.title}: ${task.status}${waiting}`,
              width: W,
              height: ROW_H,
            })
          : Text({ children: [`${task.id}  ${task.title}${waiting}`] }),
        Box({
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          children: [
            Client({
              key: 'card-' + task.id,
              module: './card.js',
              width: '100%',
              height: '100%',
              props: { id: task.id },
            }),
          ],
        }),
      ],
    });
  };
  const children = [];
  for (const section of buildSections(board)) {
    const count = section.tasks.length;
    children.push(
      isDrawn
        ? Svg({
            source: sectionSvg(section.name, count, W),
            alt: `${section.name}, ${count}`,
            width: W,
            height: SECTION_H,
          })
        : Text({ bold: true, children: [`${section.name} · ${count}`] }),
    );
    for (const task of section.tasks) children.push(row(task, section.costume));
  }
  return Box({ flexDirection: 'column', children });
};

// Agreement is what approval signs; context informs it; the build record is appended by the worker later.
const AGREEMENT = new Set(['Goal', 'Assumed', 'Approach', 'Out of scope', 'Definition of done']);
const CONTEXT = new Set([
  'Why now',
  'Background',
  'Existing work',
  'Graph context',
  'The part this builds',
  'Constraints that bite here',
]);
const tierOf = (heading) =>
  AGREEMENT.has(heading) ? 'agreement' : CONTEXT.has(heading) ? 'context' : 'record';

// One block per list item, numbered step or paragraph, so a multi-line step is edited as one thing.
export const parseSpec = (source) => {
  const [, front = '', body = source] = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
  const meta = Object.fromEntries([...front.matchAll(/^(\w+): (.+)$/gm)].map((m) => [m[1], m[2]]));
  const files = [...front.matchAll(/^ {2}- (.+)$/gm)].map((m) => m[1]);
  const text = body.replace(/<!--[\s\S]*?-->/g, '');
  const title = (text.match(/^# (.+)$/m) ?? [])[1] ?? meta.slug;
  const sections = [];
  for (const chunk of text.split(/^## /m).slice(1)) {
    const [heading, ...rest] = chunk.split('\n');
    const blocks = [];
    let current = null;
    for (const line of rest) {
      const isItem = /^(\s{0,1}[-*] |\d+\. )/.test(line);
      if (!line.trim()) {
        current = null;
        continue;
      }
      if (isItem || !current) {
        current = { text: line, state: 'open' };
        blocks.push(current);
      } else {
        current.text += '\n' + line;
      }
    }
    sections.push({ heading: heading.trim(), tier: tierOf(heading.trim()), blocks });
  }
  return { meta, files, title, sections };
};

let doc = null;
let newFiles = new Set(); // files: entries not yet in the repository
let editing = null; // { s, b } of the block being edited, or { s, b: 'new' } for an added line
const marks = {}; // block text → 'ok' | 'asked': view-only, never written, so kept across reloads
const chats = {}; // task id → [{ who, text, suggestions? } | { who, status, seconds }], so a late reply lands in its own task's chat

const chatKey = (id) => 'chat:' + board?.root + ':' + id;
const saveChat = ($, id) => $.store.set(chatKey(id), chats[id]);

const loadChat = async ($, id) => {
  chats[id] = (await $.store.get(chatKey(id))) ?? [];
};

const CHAT_SYSTEM =
  'You help a person refine a software task spec. You get the spec in full, the chat so far and their new message. ' +
  'Reply with JSON only, no prose around it: {"reply":"your answer, in markdown","replacements":[{"old":"text copied exactly from the spec","new":"what replaces it, empty to delete"}],"apply":false}. ' +
  'Answer a question briefly in reply, with no replacements. Each old must match the spec exactly once. ' +
  'Set apply to true only when the person told you to make the change, not when you are proposing one.';

// One completion per message, through the session's own model access; spec changes go through `crew task edit`.
const sendChat = async ($, text) => {
  const id = selected;
  const file = selectedTask()?.file;
  const thread = (chats[id] ??= []);
  const history = thread
    .filter((t) => !t.status)
    .slice(-10)
    .map((t) => t.who + ': ' + t.text)
    .join('\n\n');
  const turn = { who: 'planner', status: 'Reading the spec…', seconds: 0 };
  thread.push({ who: 'you', text }, turn);
  const redraw = () => $.ui.invalidate('ui.render');
  redraw();
  const tick = $.clock.every(1000, () => {
    turn.seconds += 1;
    redraw();
  });
  try {
    let spec = '';
    try {
      spec = await $.fs.read(board.root + '/' + file);
    } catch {}
    let r;
    try {
      r = await $.model.complete({
        model: 'sonnet',
        effort: 'low',
        system: CHAT_SYSTEM,
        prompt: `# The spec\n\n${spec}\n\n# The chat so far\n\n${history || '(none)'}\n\n# Their new message\n\n${text}`,
      });
    } catch (err) {
      r = { isAnswered: false, reason: 'threw', error: String(err?.message ?? err) };
    }
    let reply = r.isAnswered
      ? r.text
      : 'The model did not answer: ' + r.reason + (r.error ? ' (' + r.error + ')' : '');
    let replacements = [];
    let isApply = false;
    try {
      const out = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1));
      if (typeof out.reply === 'string') reply = out.reply;
      replacements = (Array.isArray(out.replacements) ? out.replacements : []).filter(
        (c) => typeof c?.old === 'string' && typeof c?.new === 'string',
      );
      isApply = out.apply === true;
    } catch {}
    if (isApply && replacements.length) {
      turn.status = 'Updating the spec…';
      redraw();
      for (const change of replacements)
        if (!(await crew($, ['task', id, 'edit'], JSON.stringify(change))))
          reply += `\n\n_Couldn't find '${clip(change.old, 80)}' in the spec._`;
      replacements = [];
    }
    thread[thread.indexOf(turn)] = { who: 'planner', text: reply, suggestions: replacements };
  } finally {
    tick.cancel();
  }
  await saveChat($, id);
  redraw();
};

const loadPlan = async ($, task) => {
  if (!task.part || plans[task.id]) return;
  plans[task.id] = [];
  const run = await $.process.run(['npx', '--no-install', 'crew', 'plan', task.part, '--json']);
  try {
    if (run.exitCode === 0) plans[task.id] = JSON.parse(run.stdout);
  } catch {}
};

const loadDoc = async ($) => {
  const task = selectedTask();
  if (!task) {
    doc = { meta: {}, files: [], title: 'No task selected', sections: [] };
    return;
  }
  try {
    doc = parseSpec(await $.fs.read(board.root + '/' + task.file));
  } catch {
    doc = { meta: {}, files: [], title: 'Could not read ' + task.file, sections: [] };
  }
  for (const block of doc.sections.flatMap((s) => s.blocks))
    block.state = marks[block.text] ?? 'open';
  newFiles = new Set(task.files.filter((f) => !f.exists).map((f) => f.path));
  await loadPlan($, task);
};

const openQuestions = () =>
  doc.sections.flatMap((s) => s.blocks).filter((b) => b.state === 'asked').length;

// The main session runs crew-run itself; the mod only asks, and the board shows when it has started.
const startRun = ($) => {
  void $.prompt.submit({ text: `Run task ${selected} with /crew:crew-run`, asUser: true });
};

const approve = async ($) => {
  if (!(await crew($, ['task', selected, 'approve']))) return;
  log = 'approved · starting';
  startRun($);
  $.ui.invalidate('ui.render');
};

// The button is the person saying it was checked; the session merges and records it with crew-close.
const signOff = async ($) => {
  if (!(await crew($, ['task', selected, 'signoff']))) return;
  log = 'signed off';
  void $.prompt.submit({ text: `Close task ${selected} with /crew:crew-close`, asUser: true });
  $.ui.invalidate('ui.render');
};

const sendBack = async ($) => {
  if (await crew($, ['task', selected, 'sendback'])) log = 'sent back';
};

// ---- Diagrams: data comes from the spec or a model as nodes and edges; the mod does the drawing, so layout and colours stay its own.
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
const elapsed = (seconds) => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');

// Approach steps against the files they name: a step "touches" a file whose path or file name it mentions.
export const changeMap = (spec) => {
  const approach = spec.sections.find((s) => s.heading === 'Approach');
  const steps = (approach?.blocks ?? []).map((b, i) => {
    const text = b.text.replace(/^\s*\d+\.\s*/, '');
    return {
      id: 's' + (i + 1),
      label: i + 1 + '. ' + text.split('\n')[0].replace(/[`*]/g, ''),
      text,
    };
  });
  const files = spec.files.map((path) => ({ id: path, label: path }));
  const edges = [];
  for (const step of steps)
    for (const file of files) {
      const name = file.id.split('/').pop();
      if (step.text.includes(file.id) || step.text.includes(name))
        edges.push({ from: step.id, to: file.id });
    }
  return { steps, files, edges };
};

const changeMapSvg = ({ steps, files, edges }, isNew) => {
  const ROW = 44;
  const W = 960;
  const boxW = 400;
  const height = Math.max(steps.length, files.length, 1) * ROW + 40;
  const y = (i) => 30 + i * ROW;
  const stepY = Object.fromEntries(steps.map((s, i) => [s.id, y(i)]));
  const fileY = Object.fromEntries(files.map((f, i) => [f.id, y(i)]));
  const box = (x, yy, label, fill, stroke, ink) =>
    `<rect x="${x}" y="${yy}" width="${boxW}" height="32" rx="8" fill="${fill}" stroke="${stroke}"/>` +
    `<text x="${x + 12}" y="${yy + 21}" font-family="-apple-system, sans-serif" font-size="13" fill="${ink}">${esc(clip(label, 56))}</text>`;
  const lines = edges
    .map((e) => {
      const y1 = stepY[e.from] + 16;
      const y2 = fileY[e.to] + 16;
      return `<path d="M ${boxW + 20} ${y1} C ${W / 2} ${y1}, ${W / 2} ${y2}, ${W - boxW - 20} ${y2}" fill="none" stroke="${C.border}" stroke-width="1.5"/>`;
    })
    .join('');
  const stepBoxes = steps
    .map(
      (s) =>
        `<g><title>${esc(s.text)}</title>${box(20, stepY[s.id], s.label, C.card, C.cardBorder, C.ink)}</g>`,
    )
    .join('');
  const fileBoxes = files
    .map((f) =>
      box(
        W - boxW - 20,
        fileY[f.id],
        (isNew(f.id) ? '+ ' : '') + f.label,
        isNew(f.id) ? C.ambBg : C.well,
        isNew(f.id) ? C.amb : C.cardBorder,
        C.ink,
      ),
    )
    .join('');
  const heads =
    `<text x="20" y="18" font-family="-apple-system, sans-serif" font-size="12" fill="${C.faint}">Approach steps</text>` +
    `<text x="${W - boxW - 20}" y="18" font-family="-apple-system, sans-serif" font-size="12" fill="${C.faint}">Files · + is new</text>`;
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">${heads}${lines}${stepBoxes}${fileBoxes}</svg>`,
    width: W,
    height,
  };
};

// A flowchart laid out in layers by distance from the start node; decisions are diamonds.
const flowSvg = ({ nodes, edges }) => {
  const depth = {};
  const start = nodes.find((n) => n.kind === 'start') ?? nodes[0];
  if (!start) return null;
  const queue = [start.id];
  depth[start.id] = 0;
  while (queue.length) {
    const id = queue.shift();
    for (const e of edges)
      if (e.from === id && depth[e.to] === undefined) {
        depth[e.to] = depth[id] + 1;
        queue.push(e.to);
      }
  }
  for (const n of nodes)
    if (depth[n.id] === undefined) depth[n.id] = Math.max(0, ...Object.values(depth)) + 1;
  const layers = [];
  for (const n of nodes) (layers[depth[n.id]] ??= []).push(n);
  const W = 960;
  const ROW = 96;
  const pos = {};
  layers.forEach((layer, d) =>
    layer.forEach((n, i) => {
      pos[n.id] = { x: ((i + 1) * W) / (layer.length + 1), y: 40 + d * ROW };
    }),
  );
  const height = layers.length * ROW + 40;
  const shape = (n) => {
    const { x, y } = pos[n.id];
    const label = `<text x="${x}" y="${y + 5}" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="13" fill="${C.ink}">${esc(clip(n.label, 34))}</text>`;
    if (n.kind === 'decision')
      return `<g><title>${esc(n.label)}</title><polygon points="${x},${y - 26} ${x + 130},${y} ${x},${y + 26} ${x - 130},${y}" fill="${C.vioBg}" stroke="${C.vio}"/>${label}</g>`;
    const ends = n.kind === 'start' || n.kind === 'end';
    return `<g><title>${esc(n.label)}</title><rect x="${x - 130}" y="${y - 20}" width="260" height="40" rx="${ends ? 20 : 8}" fill="${ends ? C.well : C.card}" stroke="${ends ? C.border : C.cardBorder}"/>${label}</g>`;
  };
  const arrow = (e) => {
    const a = pos[e.from];
    const b = pos[e.to];
    if (!a || !b) return '';
    const up = b.y <= a.y;
    const path = up
      ? `M ${a.x + 130} ${a.y} C ${a.x + 220} ${a.y}, ${b.x + 220} ${b.y}, ${b.x + 130} ${b.y}`
      : `M ${a.x} ${a.y + 26} L ${b.x} ${b.y - 26}`;
    const mid = up
      ? { x: Math.max(a.x, b.x) + 190, y: (a.y + b.y) / 2 }
      : { x: (a.x + b.x) / 2 + 8, y: (a.y + b.y) / 2 };
    const label = e.label
      ? `<text x="${mid.x}" y="${mid.y}" font-family="-apple-system, sans-serif" font-size="11" fill="${C.mut}">${esc(clip(e.label, 24))}</text>`
      : '';
    return `<path d="${path}" fill="none" stroke="${C.gray}" stroke-width="1.5" marker-end="url(#arrow)"/>${label}`;
  };
  const defs = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${C.gray}"/></marker></defs>`;
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">${defs}${edges.map(arrow).join('')}${nodes.map(shape).join('')}</svg>`,
    width: W,
    height,
  };
};

// The task's part in the middle, parts that feed it on the left and parts it feeds on the right; the feature layer colours by status and lists the part's symbols.
const STATUS_FILL = {
  exists: [C.well, C.gray],
  extend: [C.ambBg, C.amb],
  new: [C.clayBg, C.clay],
};

const partSvg = ({ part, edges, neighbours }, layer) => {
  const ROW = 56;
  const W = 960;
  const boxW = 280;
  const label = (id) => neighbours.find((n) => n.id === id);
  const sideOf = (isIn) => [
    ...new Set(edges.filter((e) => (e.to === part.id) === isIn).map((e) => (isIn ? e.from : e.to))),
  ];
  const left = sideOf(true);
  const right = sideOf(false);
  const surface = layer === 'feature' ? (part.surface ?? []) : [];
  const height = Math.max(left.length, right.length, 1) * ROW + 60 + surface.length * 18;
  const mid = (Math.max(left.length, right.length, 1) * ROW) / 2 + 30;
  const font = 'font-family="-apple-system, sans-serif"';
  const box = (x, cy, text, [fill, stroke], title) =>
    `<g><title>${esc(title ?? text)}</title><rect x="${x}" y="${cy - 20}" width="${boxW}" height="40" rx="8" fill="${fill}" stroke="${stroke}"/>` +
    `<text x="${x + 12}" y="${cy + 5}" ${font} font-size="13" fill="${C.ink}">${esc(clip(text, 38))}</text></g>`;
  const fillOf = (n) => (layer === 'feature' && STATUS_FILL[n?.status]) || [C.card, C.cardBorder];
  const place = (ids, x) => ids.map((id, i) => ({ id, x, y: 30 + ROW / 2 + i * ROW }));
  const spots = [...place(left, 20), ...place(right, W - boxW - 20)];
  const partX = (W - boxW) / 2;
  const lines = edges
    .map((e) => {
      const isIn = e.to === part.id;
      const spot = spots.find((p) => p.id === (isIn ? e.from : e.to) && p.x < partX === isIn);
      const x1 = isIn ? spot.x + boxW : partX + boxW;
      const x2 = isIn ? partX : spot.x;
      const y1 = isIn ? spot.y : mid;
      const y2 = isIn ? mid : spot.y;
      const text = e.label
        ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}" text-anchor="middle" ${font} font-size="11" fill="${C.mut}">${esc(clip(e.label, 24))}</text>`
        : '';
      return `<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="${C.gray}" stroke-width="1.5"/>${text}`;
    })
    .join('');
  const sides = spots
    .map((p) => box(p.x, p.y, label(p.id)?.label ?? p.id, fillOf(label(p.id))))
    .join('');
  const symbols = surface
    .map(
      (sym, i) =>
        `<text x="${partX + 8}" y="${mid + 40 + i * 18}" ${font} font-size="12" fill="${C.mut}">${sym.verified ? '✔' : '·'} ${esc(clip(sym.name + (sym.use ? ' · ' + sym.use : ''), 40))}</text>`,
    )
    .join('');
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">${lines}${sides}${box(partX, mid, part.label, layer === 'feature' ? fillOf(part) : [C.card, C.clay], part.purpose)}${symbols}</svg>`,
    width: W,
    height,
  };
};

const FLOW_SYSTEM =
  'You turn a software task spec into a runtime behaviour flowchart. Reply with JSON only, no prose: ' +
  '{"nodes":[{"id":"a","label":"short label","kind":"start|step|decision|end"}],"edges":[{"from":"a","to":"b","label":"optional, e.g. yes/no"}]}. ' +
  'At most 12 nodes, labels under 34 characters. Describe what the user and the system do, not the build steps.';

let diagram = 'change'; // which diagram the Diagrams tab shows
let flow = null; // { nodes, edges } once generated
const plans = {}; // task id → views from `crew plan <part> --json`, or [] when there is no plan for it
let flowState = 'idle'; // idle → working → done | failed

const generateFlow = async ($) => {
  flowState = 'working';
  $.ui.invalidate('ui.render');
  const part = (h) =>
    doc.sections
      .find((s) => s.heading === h)
      ?.blocks.map((b) => b.text)
      .join('\n') ?? '';
  const r = await $.model.complete({
    model: 'haiku',
    system: FLOW_SYSTEM,
    prompt: `# ${doc.title}\n\n## Goal\n${part('Goal')}\n\n## Approach\n${part('Approach')}`,
  });
  try {
    if (!r.isAnswered) throw new Error(r.reason);
    const parsed = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1));
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error('no nodes');
    flow = parsed;
    flowState = 'done';
  } catch {
    flowState = 'failed';
  }
  $.ui.invalidate('ui.render');
};

const TABS = [
  { tier: 'agreement', label: 'Spec' },
  { tier: 'context', label: 'Context' },
  { tier: 'record', label: 'Build record' },
  { tier: 'diagram', label: 'Diagrams' },
];
let tab = 'agreement';

let clears = 0; // bumped to tell the composer to empty itself

const ICON = { ok: '✔', edit: '✏', remove: '✖', ask: '?', add: '＋' };

// The Diagrams tab: a picker, then the chosen diagram as an Svg on Desktop, or a text outline where Svg does not draw.
const PLAN_POINTER =
  'No plan covers this task. Map it with /pit-crew-planning:feature-map, then give the task a `part:`.';

const diagramItems = ($, { Box, Text, Button, Markdown, Svg }, act) => {
  const task = selectedTask();
  const planned = Boolean(task?.part);
  if (!planned && (diagram === 'architecture' || diagram === 'feature')) diagram = 'change';
  const chip = (id, label) =>
    Button({
      key: 'diagram-' + id,
      label: pad(label),
      plain: true,
      dimColor: diagram !== id,
      onPress: act(() => {
        diagram = id;
      }),
    });
  const picker = Box({
    flexDirection: 'row',
    columnGap: S.sm,
    alignItems: 'center',
    children: [
      chip('change', 'Change map'),
      chip('flow', 'Behaviour flow'),
      ...(planned ? [chip('architecture', 'Architecture'), chip('feature', 'Feature')] : []),
      Box({ flexGrow: 1, children: [] }),
      ...(diagram === 'flow'
        ? [
            Button({
              key: 'generate-flow',
              label: flowState === 'working' ? 'Drawing…' : flow ? 'Redraw' : 'Generate',
              variant: 'primary',
              onPress: () => {
                if (flowState !== 'working') generateFlow($);
              },
            }),
          ]
        : []),
      Button({
        key: 'ask-diagram',
        label: pad('? Ask about this'),
        plain: true,
        dimColor: true,
        onPress: () =>
          sendChat(
            $,
            `About the ${diagram === 'change' ? 'change map' : diagram === 'flow' ? 'behaviour flow' : diagram + ' view'}: can you walk me through it?`,
          ),
      }),
    ],
  });
  const out = [{ el: picker }];
  if (!planned) out.push({ el: Text({ color: C.faint, children: [PLAN_POINTER] }) });
  if (diagram === 'architecture' || diagram === 'feature') {
    const view = (plans[task.id] ?? []).find((v) => v.layer === diagram);
    const drawn = view && partSvg(view, diagram);
    if (!view) out.push({ el: Text({ color: C.faint, children: [PLAN_POINTER] }) });
    else if (Svg)
      out.push({
        el: Box({
          key: 'diagram-view',
          children: [
            Svg({
              source: drawn.source,
              alt: `${view.part.label} and its neighbours in the ${diagram} map`,
              width: drawn.width,
              height: drawn.height,
              isInteractive: true,
            }),
          ],
        }),
      });
    else {
      const names = (ids) => ids.map((id) => view.neighbours.find((n) => n.id === id)?.label ?? id);
      out.push({
        el: Markdown({
          text: [
            `**${view.part.label}**`,
            ...view.edges.map((e) =>
              e.to === view.part.id
                ? `- ← ${names([e.from])} ${e.label ?? ''}`
                : `- → ${names([e.to])} ${e.label ?? ''}`,
            ),
          ].join('\n'),
        }),
      });
    }
  } else if (diagram === 'change') {
    const map = changeMap(doc);
    const drawn = changeMapSvg(map, (path) => newFiles.has(path));
    out.push({
      el: Svg
        ? Box({
            key: 'diagram-view',
            children: [
              Svg({
                source: drawn.source,
                alt: 'Change map: approach steps and the files each touches',
                width: drawn.width,
                height: drawn.height,
                isInteractive: true,
              }),
            ],
          })
        : Markdown({
            text: map.steps
              .map(
                (s) =>
                  `- **${s.label}** → ${
                    map.edges
                      .filter((e) => e.from === s.id)
                      .map((e) => '`' + e.to + '`')
                      .join(', ') || 'no file named'
                  }`,
              )
              .join('\n'),
          }),
    });
    const untouched = map.files.filter((f) => !map.edges.some((e) => e.to === f.id));
    if (untouched.length)
      out.push({
        el: Text({
          color: C.amb,
          children: [`No step names ${untouched.map((f) => f.id).join(', ')}`],
        }),
      });
  } else if (flowState === 'failed') {
    out.push({
      el: Text({
        color: C.clay,
        children: ['The model did not return a usable flow. Try Redraw.'],
      }),
    });
  } else if (!flow) {
    out.push({
      el: Text({
        color: C.faint,
        children: [
          flowState === 'working'
            ? 'Asking the model for the flow…'
            : 'Generate draws what the change does at runtime, from the Goal and Approach.',
        ],
      }),
    });
  } else {
    const drawn = flowSvg(flow);
    out.push({
      el:
        Svg && drawn
          ? Box({
              key: 'diagram-view',
              children: [
                Svg({
                  source: drawn.source,
                  alt: 'Behaviour flow of the change',
                  width: drawn.width,
                  height: drawn.height,
                  isInteractive: true,
                }),
              ],
            })
          : Markdown({
              text: flow.edges
                .map(
                  (e) =>
                    `- ${flow.nodes.find((n) => n.id === e.from)?.label} → ${flow.nodes.find((n) => n.id === e.to)?.label}${e.label ? ' (' + e.label + ')' : ''}`,
                )
                .join('\n'),
            }),
    });
  }
  return out;
};

const specBody = ($, { Box, Text, Button, Input, Markdown, Client, Svg }, width) => {
  const narrow = width < 100;
  const redraw = () => $.ui.invalidate('ui.render');
  const act = (fn) => () => {
    fn();
    redraw();
  };
  const ask = (block, note) => {
    block.state = marks[block.text] = 'asked';
    void sendChat($, '> ' + block.text.split('\n')[0].slice(0, 120) + '\n\n' + note);
  };

  const blockRow = (section, si, block, bi) => {
    if (editing && editing.s === si && editing.b === bi) {
      return Input({
        key: `edit-${si}-${bi}`,
        label: '',
        value: block.text.replace(/^\s*([-*]|\d+\.) (\[[ x]\] )?/, ''),
        submitLabel: 'save',
        autoFocus: true,
        onSubmit: (value) => {
          const prefix = (block.text.match(/^\s*([-*]|\d+\.) (\[[ x]\] )?/) ?? [''])[0];
          editing = null;
          editSpec($, { old: block.text, new: prefix + value });
        },
      });
    }
    const tint = block.state === 'asked' ? C.vioBg : undefined;
    const controls =
      section.tier !== 'agreement'
        ? [
            Button({
              key: `ask-${si}-${bi}`,
              label: pad(ICON.ask),
              plain: true,
              dimColor: true,
              onPress: act(() => ask(block, 'Why this?')),
            }),
          ]
        : [
            Button({
              key: `ok-${si}-${bi}`,
              label: pad(ICON.ok),
              plain: true,
              dimColor: block.state !== 'ok',
              onPress: act(() => {
                block.state = marks[block.text] = block.state === 'ok' ? 'open' : 'ok';
              }),
            }),
            Button({
              key: `edit-btn-${si}-${bi}`,
              label: pad(ICON.edit),
              plain: true,
              dimColor: true,
              onPress: act(() => {
                editing = { s: si, b: bi };
              }),
            }),
            Button({
              key: `rm-${si}-${bi}`,
              label: pad(ICON.remove),
              plain: true,
              dimColor: true,
              onPress: () => editSpec($, { old: block.text, new: '' }),
            }),
            Button({
              key: `ask-${si}-${bi}`,
              label: pad(ICON.ask),
              plain: true,
              dimColor: block.state !== 'asked',
              onPress: act(() => ask(block, 'Can we talk this one through?')),
            }),
          ];
    return Box({
      key: `block-${si}-${bi}`,
      flexDirection: 'row',
      columnGap: S.sm,
      children: [
        Box({
          flexGrow: 1,
          flexDirection: 'column',
          backgroundColor: tint,
          children: [Markdown({ text: block.text, dimColor: section.tier === 'record' })],
        }),
        Box({ flexDirection: 'row', children: controls }),
      ],
    });
  };

  // The active tab's sections as one flat list of items, so scrolling can drop whole items off the top.
  const items = [];
  doc.sections.forEach((section, si) => {
    if (section.tier !== tab) return;
    items.push({
      el: Box({
        flexDirection: 'row',
        columnGap: S.sm,
        marginTop: items.length ? S.sm : 0,
        children: [
          Text({ bold: true, color: C.ink, children: [section.heading] }),
          Box({ flexGrow: 1, children: [] }),
          ...(section.tier === 'agreement'
            ? [
                Button({
                  key: `add-${si}`,
                  label: pad(ICON.add),
                  plain: true,
                  dimColor: true,
                  onPress: act(() => {
                    editing = { s: si, b: 'new' };
                  }),
                }),
                Button({
                  key: `rm-section-${si}`,
                  label: pad(ICON.remove + ' section'),
                  plain: true,
                  dimColor: true,
                  onPress: async () => {
                    for (const block of section.blocks)
                      if (!(await editSpec($, { old: block.text, new: '' }))) return;
                  },
                }),
              ]
            : []),
        ],
      }),
    });
    section.blocks.forEach((block, bi) => items.push({ el: blockRow(section, si, block, bi) }));
    if (editing && editing.s === si && editing.b === 'new') {
      items.push({
        el: Input({
          key: `new-${si}`,
          label: '',
          placeholder: 'Add to ' + section.heading + '…',
          value: '',
          submitLabel: 'add',
          autoFocus: true,
          onSubmit: (value) => {
            editing = null;
            editSpec($, { section: section.heading, append: value });
          },
        }),
      });
    }
  });
  if (tab === 'diagram') items.push(...diagramItems($, { Box, Text, Button, Markdown, Svg }, act));
  if (!items.length) items.push({ el: Text({ color: C.faint, children: ['Nothing here yet.'] }) });

  const count = (tier) =>
    tier === 'diagram' ? 2 : doc.sections.filter((s) => s.tier === tier).length;
  const tabs = Box({
    flexDirection: 'row',
    columnGap: S.sm,
    children: TABS.map((t) =>
      Box({
        key: 'tab-box-' + t.tier,
        borderStyle: 'round',
        borderColor: tab === t.tier ? C.border : C.cardBorder,
        backgroundColor: tab === t.tier ? C.card : C.well,
        paddingX: S.xs,
        hover: { borderColor: C.border },
        children: [
          Button({
            key: 'tab-' + t.tier,
            label: pad(`${t.label} ${count(t.tier)}`),
            plain: true,
            dimColor: tab !== t.tier,
            onPress: act(() => {
              tab = t.tier;
              editing = null;
            }),
          }),
        ],
      }),
    ),
  });

  const spec = Box({
    flexDirection: 'column',
    rowGap: S.sm,
    overflow: 'hidden',
    ...(narrow ? { width: '100%' } : { width: 0, flexGrow: 3 }),
    children: [
      tabs,
      Box({ flexDirection: 'column', rowGap: S.sm, children: items.map((item) => item.el) }),
    ],
  });

  const suggestion = (thread, m, s) => {
    const { old, new: replacement } = thread[m].suggestions[s];
    const id = selected;
    const drop = () => {
      thread[m].suggestions.splice(s, 1);
      void saveChat($, id);
    };
    return Box({
      key: `suggestion-${m}-${s}`,
      flexDirection: 'column',
      rowGap: S.xs,
      borderStyle: 'round',
      borderColor: C.cardBorder,
      backgroundColor: C.card,
      paddingX: S.xs,
      children: [
        Text({ color: C.mut, children: ['− ' + old] }),
        Text({ color: C.ink, children: [replacement ? '+ ' + replacement : '+ (delete it)'] }),
        Box({
          flexDirection: 'row',
          columnGap: S.sm,
          children: [
            Button({
              key: `apply-${m}-${s}`,
              label: 'Apply',
              variant: 'primary',
              onPress: async () => {
                if (await editSpec($, { old, new: replacement })) drop();
                redraw();
              },
            }),
            Button({
              key: `dismiss-${m}-${s}`,
              label: pad('Dismiss'),
              plain: true,
              dimColor: true,
              onPress: act(drop),
            }),
          ],
        }),
      ],
    });
  };
  const thread = chats[selected] ?? [];
  const message = ({ who, text, status, seconds, suggestions = [] }, m) =>
    Box({
      key: 'message-' + m,
      flexDirection: 'column',
      rowGap: S.xs,
      alignSelf: who === 'you' ? 'flex-end' : 'flex-start',
      backgroundColor: who === 'you' ? C.well : undefined,
      paddingX: who === 'you' ? S.xs : 0,
      children: [
        ...(who === 'you' ? [] : [Text({ color: C.faint, children: [who] })]),
        status
          ? Text({ italic: true, color: C.faint, children: [status + ' ' + elapsed(seconds)] })
          : Markdown({ text }),
        ...suggestions.map((_, s) => suggestion(thread, m, s)),
      ],
    });
  // Newest first with the composer on top: the pane scrolls as a whole, so the input sits by the spec's title,
  // where it is in view whenever the spec is, instead of at the foot of a column as long as the spec.
  const chatPanel = Box({
    flexDirection: 'column',
    rowGap: S.sm,
    alignSelf: 'flex-start',
    ...(narrow ? { width: '100%' } : { width: 0, flexGrow: 2 }),
    borderStyle: 'round',
    borderColor: C.cardBorder,
    backgroundColor: C.window,
    paddingX: S.sm,
    paddingY: S.xs,
    children: [
      Box({
        flexDirection: 'row',
        columnGap: S.xs,
        children: [
          Text({ bold: true, color: C.mut, children: ['Task chat'] }),
          Text({ color: C.faint, children: ['only this task · kept out of the main session'] }),
        ],
      }),
      // ponytail: drawn by composer.js, since Desktop's Input is fixed-width and framed; typing is the mod's own, so paste is not native
      Client({
        key: 'composer',
        module: './composer.js',
        width: '100%',
        props: {
          placeholder: 'Ask about this spec, or tell the planner what to change…',
          clear: clears,
          ink: C.ink,
          faint: C.faint,
          border: C.border,
          card: C.card,
        },
      }),
      Box({
        flexDirection: 'column',
        rowGap: S.sm,
        children: thread.map((item, m) => message(item, m)).toReversed(),
      }),
    ],
  });
  return Box({
    flexDirection: narrow ? 'column' : 'row',
    columnGap: S.sm,
    rowGap: S.sm,
    children: [spec, chatPanel],
  });
};

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pitwall', description: 'Open the pit wall board' });
    refreshBoard($);
    $.clock.every(10000, () => refreshBoard($));
    return next(e);
  });

  on('command.run', { command: 'pitwall' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Pit wall', focus: true, columns: 120 });
    return {};
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Button } = $.ui.resolve(e);
    return Box({
      flexDirection: 'row',
      columnGap: 2,
      children: [
        Button({
          key: 'open-pitwall',
          label: 'Pit wall',
          onPress: () => $.ui.open({ id: PANE, title: 'Pit wall', focus: true, columns: 120 }),
        }),
      ],
    });
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE && e.requestId !== SPEC_PANE) return next(e);
    if (!isLoaded) await loadBoard($);
    const width = e.props.bodyColumns ?? 80;
    const ui = $.ui.resolve(e);
    const { Box, Text, Button } = ui;
    const redraw = () => $.ui.invalidate('ui.render');
    const edge = S.sm + 1 + S.sm; // frame padding + window border + window padding
    const inner = width - edge * 2;
    // ponytail: the rule under a title is a line of box-drawing characters, since Box has no single-side border
    const rule = Text({
      color: C.border,
      wrap: 'truncate',
      children: ['─'.repeat(Math.max(inner, 1))],
    });
    const window = (key, header, body, extra = {}) =>
      Box({
        key,
        flexDirection: 'column',
        rowGap: S.sm,
        borderStyle: 'round',
        borderColor: C.border,
        backgroundColor: C.window,
        paddingX: S.sm,
        paddingY: S.sm,
        overflow: 'hidden',
        ...extra,
        children: [Box({ flexDirection: 'column', rowGap: S.xs, children: [header, rule] }), body],
      });
    const row = (left, right) =>
      Box({
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: S.sm,
        rowGap: S.xs,
        alignItems: 'center',
        flexShrink: 0,
        children: [...left, Box({ flexGrow: 1, children: [] }), ...right],
      });
    // ponytail: wrapper Box, since Desktop drew the cards' borders but not those of the pane's top-level boxes.
    // No height: the pane scrolls as a whole, as mods have no scrolling region of their own.
    const frame = (children) =>
      Box({ flexDirection: 'column', padding: S.sm, rowGap: S.sm, children: [children].flat() });

    if (e.requestId === PANE) {
      const tasks = board?.tasks ?? [];
      const waiting = tasks.filter((t) => board.statuses[t.status]?.waitsOnUser).length;
      const header = row(
        [
          Text({ color: C.clay, bold: true, children: ['⫼'] }),
          Text({ bold: true, color: C.ink, children: ['Pit crew'] }),
          Text({
            color: C.mut,
            children: [
              `${tasks.length} tasks · ${waiting} waiting on you` + (log ? ' · ' + log : ''),
            ],
          }),
        ],
        [],
      );
      return frame([
        header,
        boardError
          ? Text({ color: C.amb, children: [boardError] })
          : boardList(ui, width - S.sm * 2, e.surface),
      ]);
    }

    if (!doc) await loadDoc($);
    if (selected && !chats[selected]) await loadChat($, selected);
    const task = selectedTask();
    const status = task?.status;
    const questions = openQuestions();
    const waiting = board?.statuses?.[status]?.waitsOnUser;
    const pendingEnv = board?.statuses?.[status]?.pendingEnv;
    const runControls = pendingEnv
      ? [
          Button({
            key: 'signoff',
            label: `Sign off · checked in ${pendingEnv}`,
            variant: 'primary',
            onPress: () => signOff($),
          }),
        ]
      : status === 'blocked'
        ? [
            Text({ color: C.mut, children: [waiting] }),
            Button({ key: 'sendback', label: 'Send back', onPress: () => sendBack($) }),
          ]
        : status === 'draft'
          ? [
              Button({
                key: 'approve',
                label: questions ? `Approve · ${questions} open` : 'Approve spec',
                variant: 'primary',
                onPress: () => approve($),
              }),
            ]
          : status === 'approved'
            ? [
                Text({ color: C.mut, children: ['Starting…'] }),
                Button({
                  key: 'start',
                  label: pad('▶ Start manually'),
                  plain: true,
                  onPress: () => {
                    log = 'started manually';
                    startRun($);
                    redraw();
                  },
                }),
              ]
            : status === 'building'
              ? [Text({ color: C.green, children: ['● Running'] })]
              : [];
    const meta = [
      doc.meta.id && '#' + doc.meta.id,
      doc.meta.env,
      doc.files.length + ' files',
      doc.meta.branch,
    ]
      .filter(Boolean)
      .join(' · ');
    const specHeader = row(
      [
        Box({
          flexDirection: 'column',
          rowGap: S.sm,
          children: [
            ui.Markdown({ text: '## ' + doc.title }),
            Text({ color: C.mut, children: [meta] }),
          ],
        }),
      ],
      [
        ...(task
          ? [
              ui.Select({
                key: 'column',
                label: '',
                options: Object.keys(board.statuses).map((name) => ({ value: name, label: name })),
                value: task.status,
                onSelect: async (to) => {
                  if (await crew($, ['task', selected, 'set', 'status', to]))
                    log = `${selected} → ${to}`;
                },
              }),
              ui.Select({
                key: 'model',
                label: '',
                options: MODELS,
                value: task.model ?? 'sonnet',
                onSelect: (m) => crew($, ['task', selected, 'set', 'model', m]),
              }),
            ]
          : []),
        ...runControls,
      ],
    );

    return frame(window('spec-window', specHeader, specBody($, ui, inner)));
  });

  on('ui.message', async ($, e, next) => {
    if (e.element.startsWith('card-') && typeof e.data?.select === 'string') {
      await select($, e.data.select);
      return {};
    }
    if (e.element !== 'composer') return next(e);
    if (typeof e.data?.send === 'string' && e.data.send.trim()) {
      clears += 1;
      log = 'sent to planner';
      void sendChat($, e.data.send);
    }
    return {};
  });
}
