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
};

// 8-point scale in cells: Desktop draws a cell at roughly 8px, so sm is the 16px step.
const S = { xs: 1, sm: 2, md: 3 };

const MODELS = [
  { value: 'opus', label: 'Opus 5.5' },
  { value: 'sonnet', label: 'Sonnet 5.5' },
  { value: 'haiku', label: 'Haiku 4.5' },
];

// The pit wall checks the task folder this often while one of its panes is open, and not at all otherwise.
const CHECK_MS = 15000;
// Past this, it reloads the board even if no task file moved: a file's existence can change what a task shows.
const STALE_MS = 120000;

let board = null; // the last `crew board --json`, for each task's file and status
let boardText = ''; // the same, as received, so an unchanged board is not parsed or redrawn
let boardError = '';
let isLoaded = false;
let loadedAt = 0;
let taskTimes = {}; // task file name → mtime and size at the last load
let selected = '';
let log = '';

// The plugin's own copy of crew, run with node: no npx resolution on every call, and always the version this mod was written for.
const crewArgv = ($, args) => ['node', $.plugin.root + '/src/cli.js', ...args];

// True when the board differs from the one drawn, so a caller knows whether to redraw.
const loadBoard = async ($) => {
  loadedAt = await $.clock.now();
  isLoaded = true;
  try {
    const run = await $.process.run(crewArgv($, ['board', '--json']));
    if (run.exitCode !== 0) {
      const why = run.stderr.trim().split('\n')[0] || 'exit ' + run.exitCode;
      throw new Error(why);
    }
    if (run.stdout === boardText && !boardError) return false;
    boardText = run.stdout;
    board = JSON.parse(run.stdout);
    boardError = '';
    if (!selectedTask()) selected = board.tasks[0]?.id ?? selected;
    return true;
  } catch (err) {
    const message = 'Could not read the board: ' + err.message;
    const changed = message !== boardError;
    boardError = message;
    return changed;
  }
};

const refreshBoard = async ($) => {
  const changed = await loadBoard($);
  if (changed || !doc) $.ui.invalidate('ui.render');
};

// Each task file's mtime and size, from one directory listing: far cheaper than running crew to find nothing changed.
const readTaskTimes = async ($) => {
  if (!board?.tasksDir) return null;
  try {
    const entries = await $.fs.list(board.tasksDir);
    return Object.fromEntries(
      entries
        .filter((entry) => entry.name.endsWith('.md'))
        .map((entry) => [entry.name, entry.mtimeMs + ':' + entry.size]),
    );
  } catch {
    return null;
  }
};

// The timer's work: nothing while no pit wall pane is open, a listing while nothing moved, the board only when something did.
export const check = async ($) => {
  const panes = await $.ui.panes();
  if (!panes.some((pane) => pane.id === PANE || pane.id === SPEC_PANE)) return;
  const times = await readTaskTimes($);
  const isStale = (await $.clock.now()) - loadedAt > STALE_MS;
  if (times && JSON.stringify(times) === JSON.stringify(taskTimes) && !isStale) return;
  const open = selectedTask()?.file.split('/').pop();
  if (!times || (open && times[open] !== taskTimes[open])) doc = null;
  taskTimes = times ?? {};
  await refreshBoard($);
};

const selectedTask = () => board?.tasks.find((t) => t.id === selected);

// Every write goes through the crew CLI, which owns the task files; a refusal is toasted and the view reloaded.
const crew = async ($, args, stdin) => {
  const run = await $.process.run(crewArgv($, args), stdin === undefined ? undefined : { stdin });
  if (run.exitCode !== 0)
    $.ui.toast(run.stderr.trim().split('\n')[0] || 'crew exited ' + run.exitCode);
  doc = null;
  await loadBoard($);
  $.ui.invalidate('ui.render');
  return run.exitCode === 0;
};

const editSpec = ($, change) => crew($, ['task', selected, 'edit'], JSON.stringify(change));

// Desktop draws a plain Button's hover itself with no padding prop, so spaces in the label widen it.
const pad = (label) => ' ' + label + ' ';

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

// ---- The crew list: tasks by the role working on them, drawn as plain rows.
const SECTIONS = [
  { name: 'Scout', color: C.vio },
  { name: 'Worker', color: C.amb },
  { name: 'Reviewer', color: C.clay },
  { name: 'Done', color: C.green },
];
const SECTION_OF = {
  draft: 'Scout',
  approved: 'Worker',
  building: 'Worker',
  review: 'Reviewer',
  blocked: 'Reviewer',
};
const sectionOf = (status) => SECTIONS.find((s) => s.name === (SECTION_OF[status] ?? 'Done'));

// Tasks by crew role, empty sections dropped; Done keeps every task still waiting on the person and the 5 newest finished.
export const buildSections = ({ statuses, tasks }) => {
  const isFinished = (t) => statuses[t.status]?.terminal;
  return SECTIONS.map(({ name, color }) => {
    const mine = tasks.filter((t) => (SECTION_OF[t.status] ?? 'Done') === name);
    const finished = mine.filter(isFinished).sort((x, y) => y.id.localeCompare(x.id));
    const shown =
      name === 'Done' ? [...mine.filter((t) => !isFinished(t)), ...finished.slice(0, 5)] : mine;
    return { name, color, tasks: shown };
  }).filter((section) => section.tasks.length);
};

// What a row's mark says at a glance: running, finished, or waiting.
const markOf = (meta) =>
  meta.inFlight ? ['●', C.blue] : meta.terminal ? ['✔', C.green] : ['○', C.faint];

// One row per task: its mark, a button with its id and title that opens it, its status and what it waits on.
const boardList = ($, { Box, Text, Button }) => {
  const row = (task, color) => {
    const meta = board.statuses[task.status] ?? {};
    const [mark, markColor] = markOf(meta);
    return Box({
      key: 'row-' + task.id,
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: S.sm,
      alignItems: 'center',
      flexShrink: 0,
      children: [
        Text({ color: markColor, children: [mark] }),
        Button({
          key: 'open-' + task.id,
          label: pad(`${task.id}  ${task.title}`),
          plain: true,
          onPress: () => select($, task.id),
        }),
        Text({ color, children: [task.status] }),
        ...(meta.waitsOnUser ? [Text({ color: C.amb, children: ['⚑ ' + meta.waitsOnUser] })] : []),
      ],
    });
  };
  const children = [];
  for (const section of buildSections(board)) {
    children.push(
      Text({
        key: 'section-' + section.name,
        bold: true,
        color: C.ink,
        children: [`${section.name} · ${section.tasks.length}`],
      }),
    );
    for (const task of section.tasks) children.push(row(task, section.color));
  }
  return Box({ flexDirection: 'column', rowGap: S.xs, children });
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
const marks = {}; // block text → 'ok': view-only, never written, so kept across reloads
const loadPlan = async ($, task) => {
  if (!task.part || plans[task.id]) return;
  plans[task.id] = [];
  const run = await $.process.run(crewArgv($, ['plan', task.part, '--json']));
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

// ---- Diagrams: the spec's shape as text. Steps against files, a model-drawn flow, and the task's part from the plan.

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

// Each step with the files it touches; a file the repository does not have yet is marked new.
const changeMapText = ({ steps, edges }, isNew) =>
  steps
    .map((s) => {
      const files = edges
        .filter((e) => e.from === s.id)
        .map((e) => '`' + e.to + '`' + (isNew(e.to) ? ' (new)' : ''));
      return `- **${s.label}** → ${files.join(', ') || 'no file named'}`;
    })
    .join('\n');

// The flow's edges in order from the start, with decision labels; a flow with no edges lists its nodes.
const flowText = ({ nodes, edges }) => {
  const label = (id) => nodes.find((n) => n.id === id)?.label ?? id;
  if (!edges.length) return nodes.map((n) => `- ${n.label}`).join('\n');
  return edges
    .map((e) => `- ${label(e.from)} → ${label(e.to)}${e.label ? ' (' + e.label + ')' : ''}`)
    .join('\n');
};

// The part with what feeds it and what it feeds; the feature layer adds statuses and the part's symbols.
const partText = ({ part, edges, neighbours }, layer) => {
  const isFeature = layer === 'feature';
  const name = (id) => {
    const n = neighbours.find((x) => x.id === id);
    return (n?.label ?? id) + (isFeature && n?.status ? ` _(${n.status})_` : '');
  };
  const lines = [
    `**${part.label}**` + (isFeature && part.status ? ` _(${part.status})_` : ''),
    ...edges.map((e) =>
      e.to === part.id
        ? `- ← ${name(e.from)}${e.label ? ' · ' + e.label : ''}`
        : `- → ${name(e.to)}${e.label ? ' · ' + e.label : ''}`,
    ),
  ];
  if (isFeature && part.surface?.length) {
    lines.push('', 'Symbols:');
    for (const sym of part.surface)
      lines.push(`- ${sym.verified ? '✔' : '·'} \`${sym.name}\`${sym.use ? ' · ' + sym.use : ''}`);
  }
  return lines.join('\n');
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

const ICON = { ok: '✔', edit: '✏', remove: '✖', add: '＋' };

const PLAN_POINTER =
  'No plan covers this task. Map it with /pit-crew-planning:feature-map, then give the task a `part:`.';

// The Diagrams tab: a picker, then the chosen diagram as Markdown.
const diagramItems = ($, { Box, Text, Button, Markdown }, act) => {
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
    ],
  });
  const view = (text) => ({
    el: Box({ key: 'diagram-view', children: [Markdown({ text })] }),
  });
  const out = [{ el: picker }];
  if (!planned) out.push({ el: Text({ color: C.faint, children: [PLAN_POINTER] }) });
  if (diagram === 'architecture' || diagram === 'feature') {
    const found = (plans[task.id] ?? []).find((v) => v.layer === diagram);
    out.push(
      found
        ? view(partText(found, diagram))
        : { el: Text({ color: C.faint, children: [PLAN_POINTER] }) },
    );
  } else if (diagram === 'change') {
    const map = changeMap(doc);
    out.push(view(changeMapText(map, (path) => newFiles.has(path))));
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
    out.push(view(flowText(flow)));
  }
  return out;
};

const specBody = ($, { Box, Text, Button, Input, Markdown }) => {
  const redraw = () => $.ui.invalidate('ui.render');
  const act = (fn) => () => {
    fn();
    redraw();
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
    const controls =
      section.tier !== 'agreement'
        ? []
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
          ];
    return Box({
      key: `block-${si}-${bi}`,
      flexDirection: 'row',
      columnGap: S.sm,
      children: [
        Box({
          flexGrow: 1,
          flexDirection: 'column',
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
  if (tab === 'diagram') items.push(...diagramItems($, { Box, Text, Button, Markdown }, act));
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

  return Box({
    flexDirection: 'column',
    rowGap: S.sm,
    overflow: 'hidden',
    children: [
      tabs,
      Box({ flexDirection: 'column', rowGap: S.sm, children: items.map((item) => item.el) }),
    ],
  });
};

const openWall = ($, focus) =>
  $.ui.open({ id: PANE, title: 'Pit wall', columns: 72, ...(focus ? { focus: true } : {}) });

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pitwall', description: 'Open the pit wall board' });
    await loadBoard($);
    // In a crew repository the wall opens with the session and stays; elsewhere the board fails to load and nothing opens.
    if (!boardError) await openWall($, false);
    $.clock.every(CHECK_MS, () => check($));
    return next(e);
  });

  on('command.run', { command: 'pitwall' }, async ($) => {
    await openWall($, true);
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
          onPress: () => openWall($, true),
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
        boardError ? Text({ color: C.amb, children: [boardError] }) : boardList($, ui),
      ]);
    }

    if (!doc) await loadDoc($);
    const task = selectedTask();
    const status = task?.status;
    const statusMeta = board?.statuses?.[status] ?? {};
    const waiting = statusMeta.waitsOnUser;
    const pendingEnv = statusMeta.pendingEnv;
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
                label: 'Approve spec',
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
    const controls = [
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
    ];
    const specHeader = row(
      [
        Box({
          flexDirection: 'column',
          rowGap: S.xs,
          children: [
            ui.Markdown({ text: '## ' + doc.title }),
            Box({
              flexDirection: 'row',
              flexWrap: 'wrap',
              columnGap: S.sm,
              children: [
                ...(task
                  ? [
                      Text({
                        key: 'spec-status',
                        bold: true,
                        color: sectionOf(status).color,
                        children: [status],
                      }),
                    ]
                  : []),
                ...(waiting ? [Text({ color: C.amb, children: ['⚑ ' + waiting] })] : []),
                Text({ color: C.mut, children: [meta] }),
              ],
            }),
          ],
        }),
      ],
      controls,
    );

    return frame(window('spec-window', specHeader, specBody($, ui)));
  });
}
