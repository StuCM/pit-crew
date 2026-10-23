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

const firstLine = (text) => text.split('\n')[0];

// A section's tasks in groups: those with no work first, then one group per work in the order met.
const groupByWork = (tasks) => {
  const groups = new Map();
  for (const task of tasks) {
    const key = task.work ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  const loose = groups.get('') ?? [];
  groups.delete('');
  return [['', loose], ...groups].filter(([, members]) => members.length);
};

// Two lines per task: its mark, id and title (the button that opens it), then its status and what it waits on.
const boardList = ($, { Box, Text, Button }, width) => {
  const rule = Text({
    color: C.border,
    wrap: 'truncate',
    children: ['─'.repeat(Math.max(width, 1))],
  });
  const row = (task, color) => {
    const meta = board.statuses[task.status] ?? {};
    const [mark, markColor] = markOf(meta);
    return Box({
      key: 'row-' + task.id,
      flexDirection: 'column',
      flexShrink: 0,
      children: [
        Box({
          flexDirection: 'row',
          columnGap: S.sm,
          alignItems: 'center',
          children: [
            Text({ color: markColor, children: [mark] }),
            Button({
              key: 'open-' + task.id,
              label: pad(`${task.id}  ${task.title}`),
              plain: true,
              onPress: () => select($, task.id),
            }),
          ],
        }),
        Box({
          flexDirection: 'row',
          columnGap: S.sm,
          paddingLeft: S.md,
          children: [
            Text({ color, children: [task.status] }),
            ...(meta.waitsOnUser && !task.blocked
              ? [Text({ color: C.amb, children: ['⚑ ' + meta.waitsOnUser] })]
              : []),
            ...(task.blocked
              ? [Text({ dimColor: true, wrap: 'truncate', children: [firstLine(task.blocked)] })]
              : []),
          ],
        }),
      ],
    });
  };
  const sectionBox = (section) => {
    const children = [
      Text({
        key: 'section-' + section.name,
        bold: true,
        color: section.color,
        children: [`${section.name} · ${section.tasks.length}`],
      }),
      rule,
    ];
    for (const [work, members] of groupByWork(section.tasks)) {
      if (work)
        children.push(
          Text({
            key: `work-${section.name}-${work}`,
            dimColor: true,
            children: [board.works?.[work] ?? work],
          }),
        );
      for (const task of members) children.push(row(task, section.color));
    }
    return Box({ key: 'box-' + section.name, flexDirection: 'column', rowGap: S.xs, children });
  };
  return Box({
    flexDirection: 'column',
    rowGap: S.sm,
    children: buildSections(board).map(sectionBox),
  });
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
        current = { text: line };
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

const TABS = [
  { tier: 'agreement', label: 'Spec' },
  { tier: 'context', label: 'Context' },
  { tier: 'record', label: 'Build record' },
];
let tab = 'agreement';

const specBody = ($, { Box, Text, Button, Markdown }) => {
  const redraw = () => $.ui.invalidate('ui.render');
  const act = (fn) => () => {
    fn();
    redraw();
  };
  const blockRow = (section, si, block, bi) =>
    Box({
      key: `block-${si}-${bi}`,
      flexDirection: 'column',
      children: [Markdown({ text: block.text, dimColor: section.tier === 'record' })],
    });

  // The active tab's sections as one flat list of items, so scrolling can drop whole items off the top.
  const items = [];
  doc.sections.forEach((section, si) => {
    if (section.tier !== tab) return;
    items.push({
      el: Box({
        marginTop: items.length ? S.sm : 0,
        children: [Text({ bold: true, color: C.ink, children: [section.heading] })],
      }),
    });
    section.blocks.forEach((block, bi) => items.push({ el: blockRow(section, si, block, bi) }));
  });
  if (!items.length) items.push({ el: Text({ color: C.faint, children: ['Nothing here yet.'] }) });

  const count = (tier) => doc.sections.filter((s) => s.tier === tier).length;
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
        boardError ? Text({ color: C.amb, children: [boardError] }) : boardList($, ui, inner),
      ]);
    }

    if (!doc) await loadDoc($);
    const task = selectedTask();
    const status = task?.status;
    const statusMeta = board?.statuses?.[status] ?? {};
    const waiting = statusMeta.waitsOnUser;
    const pendingEnv = statusMeta.pendingEnv;
    const why = status === 'blocked' && task.blocked ? task.blocked : waiting;
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
            Text({ color: C.mut, children: [why] }),
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
    const specHeader = Box({
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
            Text({ color: C.mut, children: [meta] }),
          ],
        }),
        ...(why && why !== task.blocked ? [Text({ color: C.amb, children: ['⚑ ' + why] })] : []),
        Box({
          flexDirection: 'row',
          flexWrap: 'wrap',
          columnGap: S.sm,
          rowGap: S.xs,
          alignItems: 'center',
          children: controls,
        }),
      ],
    });

    return frame(window('spec-window', specHeader, specBody($, ui)));
  });
}
