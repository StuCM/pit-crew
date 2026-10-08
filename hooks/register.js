// Throwaway spike: the "Pit Crew Task Board" design as one mod pane, board above spec.
// ponytail: one pane because the dock shows several panes as tabs, never stacked
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
  vioBg: '#EEEDFE',
};

// 8-point scale in cells: Desktop draws a cell at roughly 8px, so sm is the 16px step.
const S = { xs: 1, sm: 2, md: 3 };

const MODELS = [
  { value: 'opus', label: 'Opus 5.5' },
  { value: 'sonnet', label: 'Sonnet 5.5' },
  { value: 'haiku', label: 'Haiku 4.5' },
];

// Columns come from `crew board --json`: one per crew status, cards are [title, id, who, attention].
let COLUMNS = [];
let board = null; // the last `crew board --json`, for each task's file and status
let boardError = '';
let isLoaded = false;

const dotFor = (meta) =>
  meta.waitsOnUser ? C.clay : meta.inFlight ? C.blue : meta.terminal ? C.green : C.gray;

export const buildColumns = ({ statuses, tasks }) =>
  Object.entries(statuses).map(([name, meta]) => {
    const mine = tasks.filter((t) => t.status === name);
    const shown = meta.terminal ? mine.sort((x, y) => y.id.localeCompare(x.id)).slice(0, 5) : mine;
    return {
      name,
      dot: dotFor(meta),
      cards: shown.map((t) => [t.title, t.id, t.model ?? 'unassigned', meta.waitsOnUser ?? '']),
    };
  });

const loadBoard = async ($) => {
  try {
    const run = await $.process.run(['npx', '--no-install', 'crew', 'board', '--json']);
    if (run.exitCode !== 0) {
      const why = run.stderr.trim().split('\n')[0] || 'exit ' + run.exitCode;
      throw new Error(why);
    }
    board = JSON.parse(run.stdout);
    COLUMNS = buildColumns(board);
    boardError = '';
    if (!findCard(selected)) selected = COLUMNS.flatMap((c) => c.cards)[0]?.[1] ?? selected;
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
let isFull = false;
let isSpecOpen = true; // closing the spec gives the board the pane
let isPoppedOut = false;
let log = '';

const findCard = (id) => {
  for (const col of COLUMNS) {
    const card = col.cards.find((c) => c[1] === id);
    if (card) return { card, col };
  }
};

const select = ($, id) => {
  selected = id;
  doc = null;
  isSpecOpen = true;
  if (isPoppedOut) $.ui.open({ id: SPEC_PANE, title: 'Spec · ' + id });
  $.ui.invalidate('ui.render');
};

const boardView = ($, { Box, Text, Svg, Client }, width, surface) => {
  const narrow = width < 100;
  // Rows a card takes: border, padding, wrapped title, meta, and the attention and tag lines with their gaps.
  const colWidth = narrow
    ? width
    : Math.floor((width - (COLUMNS.length - 1) * (S.sm * 2 + 1)) / COLUMNS.length);
  const cardRows = ([title, , , attention]) =>
    2 +
    S.xs * 2 +
    Math.ceil(title.length / Math.max(colWidth - S.sm * 2 - 2, 8)) +
    S.xs +
    1 +
    (attention ? S.xs + 1 : 0);
  // A Client has no height of its own in the terminal, so there each card is given its estimated rows; Desktop sizes it from its content.
  const card = ([title, id, who, attention]) =>
    Client({
      key: 'card-' + id,
      width: '100%',
      ...(surface === 'desktop' ? {} : { height: cardRows([title, id, who, attention]) }),
      module: './card.js',
      props: {
        title,
        id,
        who,
        isSelected: id === selected,
        attention,
        tags: [],
        colors: C,
      },
    });
  const column = (col) =>
    Box({
      flexDirection: 'column',
      rowGap: S.sm,
      ...(narrow ? { width: '100%' } : { width: 0, flexGrow: 1 }),
      children: [
        Box({
          flexDirection: 'row',
          columnGap: S.xs,
          children: [
            Text({ color: col.dot, children: ['●'] }),
            Text({ bold: true, color: C.mut, children: [col.name] }),
            Text({ color: C.faint, children: [String(col.cards.length)] }),
          ],
        }),
        ...col.cards.map(card),
      ],
    });
  if (narrow) return Box({ flexDirection: 'column', rowGap: S.sm, children: COLUMNS.map(column) });
  // Rows a column takes: header, then per card its border, padding, wrapped title, meta and tags, plus the gap.
  const tallest = Math.max(
    ...COLUMNS.map((col) => 1 + col.cards.reduce((n, c) => n + S.sm + cardRows(c), 0)),
  );
  // ponytail: Box has no single-side border, so the divider is sized from the estimate above, short by a gap at each end.
  // Desktop gets a 1px Svg line (stacked │ glyphs draw dashed there); ROW_PX is a guess at Desktop's row height.
  const ROW_PX = 22;
  const rows = Math.max(tallest - S.sm * 2, 1);
  const divider = () =>
    Box({
      marginY: S.sm,
      children: [
        surface === 'desktop' && Svg
          ? Svg({
              source: `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="${rows * ROW_PX}"><rect width="1" height="${rows * ROW_PX}" fill="${C.cardBorder}"/></svg>`,
              alt: '',
              width: 1,
              height: rows * ROW_PX,
            })
          : Text({ color: C.cardBorder, children: [Array(rows).fill('│').join('\n')] }),
      ],
    });
  const children = COLUMNS.flatMap((col, i) =>
    i === 0 ? [column(col)] : [divider(), column(col)],
  );
  return Box({ flexDirection: 'row', columnGap: S.sm, children });
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
const chats = {}; // task id → [{ who, text, suggestions? }], so a late reply lands in its own task's chat

// `crew chat` keeps the conversation; the mod only shows it, so the main session never sees it.
const loadChat = async ($, id) => {
  chats[id] = [];
  const run = await $.process.run(['npx', '--no-install', 'crew', 'chat', id, '--history']);
  if (run.exitCode !== 0) return;
  try {
    chats[id] = JSON.parse(run.stdout).map(({ who, text }) => ({ who, text }));
  } catch {}
};

const sendChat = async ($, text) => {
  const id = selected;
  const thread = (chats[id] ??= []);
  const reply = { who: 'planner', text: 'planner is thinking…', suggestions: [] };
  thread.push({ who: 'you', text }, reply);
  $.ui.invalidate('ui.render');
  let out = null;
  let why = '';
  try {
    const run = await $.process.run(['npx', '--no-install', 'crew', 'chat', id], {
      stdin: text,
      timeoutMs: 600000,
    });
    why = run.stderr.trim().split('\n')[0] || 'crew chat exited ' + run.exitCode;
    out = JSON.parse(run.stdout.trim().split('\n').at(-1));
  } catch (err) {
    why ||= err.message;
  }
  reply.text = out?.text || why;
  reply.suggestions = out?.suggestions ?? [];
  if (out?.reverted?.length)
    reply.text += '\n\n_Reverted its changes to ' + out.reverted.join(', ') + '._';
  if (out?.edited) await refreshBoard($);
  else $.ui.invalidate('ui.render');
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

// ---- Diagrams: data comes from the spec or a model as nodes and edges; the mod does the drawing, so layout and colours stay its own.
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

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

const FLOW_SYSTEM =
  'You turn a software task spec into a runtime behaviour flowchart. Reply with JSON only, no prose: ' +
  '{"nodes":[{"id":"a","label":"short label","kind":"start|step|decision|end"}],"edges":[{"from":"a","to":"b","label":"optional, e.g. yes/no"}]}. ' +
  'At most 12 nodes, labels under 34 characters. Describe what the user and the system do, not the build steps.';

let diagram = 'change'; // which diagram the Diagrams tab shows
let flow = null; // { nodes, edges } once generated
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
const diagramItems = ($, { Box, Text, Button, Markdown, Svg }, act) => {
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
            `About the ${diagram === 'flow' ? 'behaviour flow' : 'change map'}: can you walk me through it?`,
          ),
      }),
    ],
  });
  const out = [{ el: picker }];
  if (diagram === 'change') {
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
    const drop = () => thread[m].suggestions.splice(s, 1);
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
  const message = ({ who, text, suggestions = [] }, m) =>
    Box({
      key: 'message-' + m,
      flexDirection: 'column',
      rowGap: S.xs,
      alignSelf: who === 'you' ? 'flex-end' : 'flex-start',
      backgroundColor: who === 'you' ? C.well : undefined,
      paddingX: who === 'you' ? S.xs : 0,
      children: [
        ...(who === 'you' ? [] : [Text({ color: C.faint, children: [who] })]),
        Markdown({ text }),
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
    if (!doc) await loadDoc($);
    if (selected && !chats[selected]) await loadChat($, selected);
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

    const found = findCard(selected);
    const status = selectedTask()?.status;
    const questions = openQuestions();
    const runControls =
      status === 'draft'
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
        ...(found
          ? [
              ui.Select({
                key: 'column',
                label: '',
                options: COLUMNS.map((c) => ({ value: c.name, label: c.name })),
                value: found.col.name,
                onSelect: async (to) => {
                  if (await crew($, ['task', selected, 'set', 'status', to]))
                    log = `${selected} → ${to}`;
                },
              }),
              ui.Select({
                key: 'model',
                label: '',
                options: MODELS,
                value: selectedTask()?.model ?? 'sonnet',
                onSelect: (m) => crew($, ['task', selected, 'set', 'model', m]),
              }),
            ]
          : []),
        ...runControls,
        ...(e.requestId === SPEC_PANE
          ? []
          : [
              Button({
                key: 'full',
                label: pad(isFull ? '⤡ Show board' : '⤢ Full view'),
                plain: true,
                onPress: () => {
                  isFull = !isFull;
                  redraw();
                },
              }),
              Button({
                key: 'pop-out',
                label: pad('↗ Own pane'),
                plain: true,
                onPress: async () => {
                  isPoppedOut = true;
                  isFull = false;
                  await $.ui.open({ id: SPEC_PANE, title: 'Spec · ' + selected, focus: true });
                  redraw();
                },
              }),
              Button({
                key: 'close-spec',
                label: pad('✖ Close'),
                plain: true,
                dimColor: true,
                onPress: () => {
                  isSpecOpen = false;
                  isFull = false;
                  redraw();
                },
              }),
            ]),
      ],
    );

    const spec = window('spec-window', specHeader, specBody($, ui, inner));
    if (e.requestId === SPEC_PANE) return frame(spec);

    const header = row(
      [
        Text({ color: C.clay, bold: true, children: ['⫼'] }),
        Text({ bold: true, color: C.ink, children: ['Pit crew'] }),
        Text({ color: C.mut, children: ['3 agents working' + (log ? ' · ' + log : '')] }),
      ],
      [
        Button({
          key: 'filter',
          label: pad('Filter'),
          plain: true,
          dimColor: true,
          onPress: () => {},
        }),
        Button({ key: 'new-task', label: 'New task', variant: 'primary', onPress: () => {} }),
      ],
    );
    const boardWindow = window(
      'board-window',
      Text({ bold: true, color: C.mut, children: ['Board'] }),
      boardError
        ? Text({ color: C.amb, children: [boardError] })
        : boardView($, ui, inner, e.surface),
      { flexShrink: 0 },
    );
    if (isPoppedOut || !isSpecOpen) return frame([header, boardWindow]);
    if (isFull) return frame([header, spec]);
    return frame([header, boardWindow, spec]);
  });

  on('ui.message', async ($, e, next) => {
    if (e.element.startsWith('card-') && typeof e.data?.select === 'string') {
      select($, e.data.select);
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

  on('ui.close', async ($, e, next) => {
    if (e.id === SPEC_PANE) {
      isPoppedOut = false;
      $.ui.invalidate('ui.render');
    }
    return next(e);
  });
}
