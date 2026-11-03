const PANE = 'crew-wall';
const SPEC_PANE = 'crew-spec';
const REVIEW_PANE = 'crew-review';

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
let selectedGroup = ''; // the work slug whose page the side pane shows, or ''
let groupTab = 'brief'; // or 'review'
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
  selectedGroup = '';
  doc = null;
  await $.ui.open({
    id: SPEC_PANE,
    title: id + ' · ' + (selectedTask()?.title ?? ''),
    focus: true,
  });
  $.ui.invalidate('ui.render');
};

const selectGroup = async ($, group) => {
  selectedGroup = group.slug;
  selected = '';
  groupTab = 'brief';
  await $.ui.open({ id: SPEC_PANE, title: group.title, focus: true });
  $.ui.invalidate('ui.render');
};

// A blocked task says who stopped it and why; any other waiting status, what it waits on.
export const waitText = (task, meta) =>
  task?.status === 'blocked' && task.blocked
    ? `${task.blockedBy ?? 'stopped'}: ${task.blocked}`
    : meta.waitsOnUser;

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

// A narrow-pane row: what to click on the first line, what it says about itself indented on the second.
const twoLine = ({ Box }, key, first, second) =>
  Box({
    key,
    flexDirection: 'column',
    flexShrink: 0,
    children: [
      Box({ flexDirection: 'row', columnGap: S.sm, alignItems: 'center', children: first }),
      Box({
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: S.sm,
        paddingLeft: S.md,
        alignItems: 'center',
        children: second,
      }),
    ],
  });

const flag = (Text, task, meta) =>
  meta.waitsOnUser
    ? [Text({ color: C.amb, wrap: 'truncate', children: ['⚑ ' + waitText(task, meta)] })]
    : [];

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
  const titles = Object.fromEntries((board.works ?? []).map((w) => [w.slug, w.title]));
  const rule = Text({
    color: C.border,
    wrap: 'truncate',
    children: ['─'.repeat(Math.max(width, 1))],
  });
  const row = (task) => {
    const meta = board.statuses[task.status] ?? {};
    const [mark, markColor] = markOf(meta);
    return twoLine(
      { Box },
      'row-' + task.id,
      [
        Text({ color: markColor, children: [mark] }),
        Button({
          key: 'open-' + task.id,
          label: pad(`${task.id}  ${task.title}`),
          plain: true,
          onPress: () => select($, task.id),
        }),
      ],
      [Text({ dimColor: true, children: [task.status] }), ...flag(Text, task, meta)],
    );
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
            children: [titles[work] ?? work],
          }),
        );
      for (const task of members) children.push(row(task));
    }
    return Box({ key: 'box-' + section.name, flexDirection: 'column', rowGap: S.xs, children });
  };
  return Box({
    flexDirection: 'column',
    rowGap: S.sm,
    children: buildSections(board).map(sectionBox),
  });
};

// ---- The group view: each piece of work with its tasks in build order, its pilot, and what holds it.
let wallView = 'groups'; // or 'crew', the list by role
const expanded = {}; // work slug → true or false once the person has toggled it

// Groups in build order with their tasks, finished groups last; tasks with no work under Ungrouped.
export const buildGroups = ({ statuses, tasks, works = [] }) => {
  const known = new Set(works.map((w) => w.slug));
  const groups = works.map((work) => {
    const mine = tasks.filter((t) => t.work === work.slug);
    const at = (t) => (work.order.includes(t.id) ? work.order.indexOf(t.id) : work.order.length);
    mine.sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
    return { ...work, tasks: mine };
  });
  const loose = tasks.filter((t) => !t.work || !known.has(t.work));
  if (loose.length)
    groups.push({
      slug: '',
      title: 'Ungrouped',
      order: [],
      raised: [],
      problems: [],
      tasks: loose,
    });
  const isDone = (g) => g.tasks.every((t) => statuses[t.status]?.terminal);
  return groups.filter((g) => g.tasks.length).sort((a, b) => Number(isDone(a)) - Number(isDone(b)));
};

// The counts a collapsed group shows: finished, running, and waiting on the person.
export const groupCounts = ({ statuses }, group) => {
  const count = (test) => group.tasks.filter((t) => test(statuses[t.status] ?? {})).length;
  return {
    done: count((m) => m.terminal),
    running: count((m) => m.inFlight),
    waiting: count((m) => m.waitsOnUser),
    questions: (group.raised ?? []).filter((r) => !r.answer).length,
  };
};

// Only a group with a draft task has anything left to approve.
const needsApproval = (group) =>
  group.slug && !group.approved && group.tasks.some((t) => t.status === 'draft');

const approveRow = ($, { Text, Button }, group) =>
  group.problems.length
    ? Text({ color: C.mut, children: ['Not ready: ' + group.problems.join('; ')] })
    : Button({
        key: 'approve-' + group.slug,
        label: 'Approve group',
        variant: 'primary',
        onPress: () => approveGroup($, group),
      });

const raisedText = (r) => {
  const holds = r.affects?.length ? ` · holds ${r.affects.join(', ')}` : '';
  return `? ${r.ref} ${r.from ?? 'reviewer'} on ${r.task}: ${r.q}${holds}`;
};

const isExpanded = (group, counts) =>
  expanded[group.slug] ?? (counts.waiting > 0 || counts.questions > 0 || !group.approved);

// Move a not-yet-started task one place in its group's build order.
const move = ($, group, id, by) => {
  const ids = group.tasks.map((t) => t.id);
  const from = ids.indexOf(id);
  const to = from + by;
  if (to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return crew($, ['work', group.slug, 'order', ids.join(',')]);
};

const approveGroup = async ($, group) => {
  if (!(await crew($, ['work', group.slug, 'approve']))) return;
  log = group.slug + ' approved · starting';
  void $.prompt.submit({
    text: `Run the ${group.slug} group with /crew:crew-run`,
    asUser: true,
  });
  $.ui.invalidate('ui.render');
};

const groupList = ($, { Box, Text, Button }) => {
  const children = [];
  for (const group of buildGroups(board)) {
    const counts = groupCounts(board, group);
    const isOpen = isExpanded(group, counts);
    const fold = () => {
      expanded[group.slug] = !isOpen;
      $.ui.invalidate('ui.render');
    };
    const summary = [
      group.shape,
      `${counts.done}/${group.tasks.length} done`,
      counts.running ? `${counts.running} running` : '',
      counts.waiting ? `⚑ ${counts.waiting}` : '',
      counts.questions ? `? ${counts.questions}` : '',
    ].filter(Boolean);
    children.push(
      twoLine(
        { Box },
        'grouprow-' + (group.slug || 'none'),
        [
          Button({
            key: 'fold-' + (group.slug || 'none'),
            label: pad(isOpen ? '▾' : '▸'),
            plain: true,
            onPress: fold,
          }),
          Button({
            key: 'group-' + (group.slug || 'none'),
            label: pad(group.title),
            plain: true,
            onPress: group.slug ? () => selectGroup($, group) : fold,
          }),
        ],
        [
          Text({
            color: counts.waiting || counts.questions ? C.amb : C.mut,
            children: [summary.join(' · ')],
          }),
        ],
      ),
    );
    if (!isOpen) continue;

    const body = [];
    if (group.slug && group.tasks.some((t) => !['draft', 'approved'].includes(t.status))) {
      body.push(
        Button({
          key: 'review-' + group.slug,
          label: pad('Review the group'),
          plain: true,
          onPress: () => openReview($, group.slug, group.title),
        }),
      );
      if (board.preview)
        body.push(
          Button({
            key: 'preview-' + group.slug,
            label: pad('Preview the group'),
            plain: true,
            onPress: () => preview($, ['group', group.slug]),
          }),
        );
    }
    if (needsApproval(group)) body.push(approveRow($, { Text, Button }, group));
    for (const r of group.raised ?? []) {
      if (r.answer) continue;
      body.push(
        Text({
          key: `raised-${group.slug}-${r.ref}`,
          color: C.amb,
          children: [raisedText(r)],
        }),
      );
    }
    group.tasks.forEach((task, i) => {
      const meta = board.statuses[task.status] ?? {};
      const [mark, markColor] = markOf(meta);
      const isPilot = group.pilot === task.id;
      const canMove = group.slug && (task.status === 'draft' || task.status === 'approved');
      body.push(
        twoLine(
          { Box },
          'row-' + task.id,
          [
            Text({ color: markColor, children: [mark] }),
            Button({
              key: 'open-' + task.id,
              label: pad(`${task.id}  ${task.title}`),
              plain: true,
              onPress: () => select($, task.id),
            }),
          ],
          [
            Text({ dimColor: true, children: [task.status] }),
            ...(isPilot ? [Text({ color: C.clay, children: ['★ pilot'] })] : []),
            ...flag(Text, task, meta),
            ...(canMove
              ? [
                  ...(i > 0
                    ? [
                        Button({
                          key: 'up-' + task.id,
                          label: '↑',
                          plain: true,
                          onPress: () => move($, group, task.id, -1),
                        }),
                      ]
                    : []),
                  ...(i < group.tasks.length - 1
                    ? [
                        Button({
                          key: 'down-' + task.id,
                          label: '↓',
                          plain: true,
                          onPress: () => move($, group, task.id, 1),
                        }),
                      ]
                    : []),
                  Button({
                    key: 'pilot-' + task.id,
                    label: isPilot ? 'unpilot' : 'pilot',
                    plain: true,
                    onPress: () =>
                      crew($, ['work', group.slug, 'pilot', isPilot ? 'none' : task.id]),
                  }),
                ]
              : []),
          ],
        ),
      );
    });
    children.push(
      Box({ flexDirection: 'column', rowGap: S.xs, paddingLeft: S.md, children: body }),
    );
  }
  return Box({ flexDirection: 'column', rowGap: S.xs, children });
};

// ---- The preview: one running copy of the app, pointed at a task, a group or the base.
// crew prints what it did and any ⚠ about migrations or dependencies; the warnings are toasted.
const preview = async ($, args) => {
  const run = await $.process.run(crewArgv($, ['preview', ...args]));
  const lines = (run.exitCode === 0 ? run.stdout : run.stderr).trim().split('\n');
  log = lines[0] ?? '';
  if (run.exitCode !== 0) $.ui.toast(lines[0] || 'crew preview exited ' + run.exitCode);
  for (const line of lines.filter((l) => l.includes('⚠'))) $.ui.toast(line.trim());
  await loadBoard($);
  $.ui.invalidate('ui.render');
  return run.exitCode === 0;
};

// The wall's preview line: what it shows, and the edits made there with Keep and Drop.
const previewLine = ($, { Box, Text, Button }) => {
  const pv = board?.preview;
  if (!pv || pv.error) return null;
  const edits = pv.edits ?? [];
  return twoLine(
    { Box },
    'preview-line',
    [
      Text({ color: C.mut, children: ['Preview'] }),
      Text({ color: C.ink, wrap: 'truncate', children: [pv.state?.label ?? 'unknown'] }),
    ],
    edits.length
      ? [
          Text({ color: C.amb, children: [`✎ ${edits.map((e) => e.path).join(', ')}`] }),
          Button({
            key: 'preview-keep',
            label: 'Keep',
            variant: 'primary',
            onPress: () => preview($, ['keep']),
          }),
          Button({
            key: 'preview-drop',
            label: pad('Drop'),
            plain: true,
            onPress: () => preview($, ['drop']),
          }),
        ]
      : [
          Button({
            key: 'preview-main',
            label: pad('show main'),
            plain: true,
            onPress: () => preview($, ['main']),
          }),
        ],
  );
};

// ---- The review pane: what a task or group changed, read from git, without opening its worktree.
let review = null; // { target, title, data, file, commit, commitData, mode, top, hits, lines, showAllFiles }
let reviewHeader = 0; // rows drawn above the code window, so a wheel over them is not taken as scrolling the code
let reviewCount = 8; // rows the code window shows, as last drawn

// Where a scroll by `by` leaves the window's first row: never past the point where the window stays full.
export const nextTop = (top, by, total, count) =>
  Math.max(0, Math.min(top + by, Math.max(total - count, 0)));
const MAX_FILES = 10;
const MAX_COMMITS = 6;
const MAX_HITS = 8;

// A crew command whose stdout is one JSON value; a refusal is toasted and null returned.
const crewJson = async ($, args) => {
  const run = await $.process.run(crewArgv($, args));
  try {
    const value = JSON.parse(run.stdout);
    if (value.error) $.ui.toast(value.error);
    return value.error ? null : value;
  } catch {
    $.ui.toast(run.stderr.trim().split('\n')[0] || 'crew exited ' + run.exitCode);
    return null;
  }
};

// Every diff line of the files shown, with the line numbers a cut hunk needs to be redrawn from anywhere.
export const diffRows = (files) => {
  const rows = [];
  for (const file of files) {
    rows.push({ kind: 'file', path: file.path, file });
    file.hunks.forEach((hunk, h) => {
      const at = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(hunk.header);
      let a = Number(at?.[1] ?? 1);
      let b = Number(at?.[2] ?? 1);
      for (const line of hunk.lines) {
        rows.push({ kind: line.kind, text: line.text, a, b, hunk: file.path + '#' + h });
        if (line.kind !== '+') a++;
        if (line.kind !== '-') b++;
      }
    });
  }
  return rows;
};

// The rows a window shows, as file markers and hunks that parse: each run of lines gets its own @@ header.
export const windowParts = (rows, top, count) => {
  const parts = [];
  let run = null;
  for (const row of rows.slice(top, top + count)) {
    if (row.kind === 'file') {
      run = null;
      parts.push({ kind: 'file', path: row.path, file: row.file });
      continue;
    }
    if (!run || run.hunk !== row.hunk) {
      run = {
        kind: 'code',
        hunk: row.hunk,
        path: row.hunk.split('#')[0],
        a: row.a,
        b: row.b,
        lines: [],
      };
      parts.push(run);
    }
    run.lines.push(row);
  }
  for (const part of parts) {
    if (part.kind !== 'code') continue;
    const old = part.lines.filter((l) => l.kind !== '+').length;
    const now = part.lines.filter((l) => l.kind !== '-').length;
    part.source = [
      `@@ -${part.a},${old} +${part.b},${now} @@`,
      ...part.lines.map((l) => l.kind + l.text),
    ].join('\n');
  }
  return parts;
};

const loadReview = async ($) => {
  const data = await crewJson($, ['changes', review.target]);
  if (data) review.data = data;
  if (review.commit)
    review.commitData = await crewJson($, ['changes', review.target, '--commit', review.commit]);
  if (review.mode === 'file' && review.file) await loadFile($);
};

const loadFile = async ($) => {
  const got = await crewJson($, ['changes', review.target, '--file', review.file]);
  review.lines = got?.lines ?? [];
};

const openReview = async ($, target, title) => {
  review = {
    target,
    title,
    data: null,
    file: null,
    commit: null,
    mode: 'diff',
    top: 0,
    hits: null,
    lines: [],
  };
  await loadReview($);
  await $.ui.open({ id: REVIEW_PANE, title: 'Review · ' + title, focus: true });
  $.ui.invalidate('ui.render');
};

const pickFile = async ($, path) => {
  review.file = path;
  review.top = 0;
  if (review.mode === 'file') await loadFile($);
  $.ui.invalidate('ui.render');
};

const pickCommit = async ($, sha) => {
  review.commit = sha;
  review.top = 0;
  review.commitData = sha ? await crewJson($, ['changes', review.target, '--commit', sha]) : null;
  $.ui.invalidate('ui.render');
};

const setMode = async ($, mode) => {
  review.mode = mode;
  review.top = 0;
  if (mode === 'file') {
    review.file ??= review.data?.files[0]?.path ?? null;
    if (review.file) await loadFile($);
  }
  $.ui.invalidate('ui.render');
};

const searchCode = async ($, text) => {
  review.hits = text.trim() ? await crewJson($, ['changes', review.target, '--grep', text]) : null;
  $.ui.invalidate('ui.render');
};

const openHit = async ($, hit) => {
  review.file = hit.path;
  review.mode = 'file';
  await loadFile($);
  review.top = Math.max(hit.line - 4, 0);
  $.ui.invalidate('ui.render');
};

// "42: use the helper" aims at line 42 of the file shown; without a number, at the file.
const suggestChange = async ($, text) => {
  const file = review.data?.files.find((f) => f.path === review.file);
  if (!file) return $.ui.toast('Pick a file first: a suggestion is about one file');
  const at = /^\s*(\d+)\s*[:.-]?\s*(.*)$/.exec(text);
  const note = (at ? at[2] : text).trim();
  if (!note) return;
  if (await crew($, ['suggest', file.task, file.path, at ? at[1] : '-', note])) {
    log = 'suggestion recorded';
    await loadReview($);
    $.ui.invalidate('ui.render');
  }
};

const applyFixes = ($, ids) => {
  for (const id of ids) {
    void $.prompt.submit({
      text: `Apply the open suggestions on task ${id} with \`crew fix ${id}\`, and tell me what the fixer did`,
      asUser: true,
    });
  }
};

// What the code window scrolls over: the commit's diff, the whole diff, one file's, or the file itself.
const reviewRows = () => {
  if (review.mode === 'file')
    return review.lines.map((text, i) => ({ kind: 'src', text, n: i + 1 }));
  const files = (review.commit ? review.commitData?.files : review.data?.files) ?? [];
  return diffRows(review.file ? files.filter((f) => f.path === review.file) : files);
};

const reviewBody = ($, { Box, Text, Button, Input, Code }, { bodyRows, inner }) => {
  const data = review.data;
  const head = [];
  const line = (key, children) =>
    head.push(
      Box({
        key,
        flexDirection: 'row',
        columnGap: S.sm,
        alignItems: 'center',
        flexShrink: 0,
        children,
      }),
    );
  const toggle = (key, label, isOn, onPress) =>
    Button({ key, label: pad(label), ...(isOn ? {} : { plain: true }), onPress });

  const files = data?.files ?? [];
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  line('review-title', [
    Text({ bold: true, color: C.ink, wrap: 'truncate', children: [review.title] }),
  ]);
  line('review-stats', [
    Text({
      color: C.mut,
      children: [
        `${files.length} files · +${added} −${removed} · ${data?.commits.length ?? 0} commits`,
      ],
    }),
    toggle('mode-diff', 'Diff', review.mode === 'diff', () => setMode($, 'diff')),
    toggle('mode-file', 'File', review.mode === 'file', () => setMode($, 'file')),
    Button({
      key: 'review-refresh',
      label: pad('↻'),
      plain: true,
      onPress: async () => {
        await loadReview($);
        $.ui.invalidate('ui.render');
      },
    }),
  ]);
  for (const miss of data?.missing ?? [])
    line('missing-' + miss.task, [
      Text({ color: C.faint, wrap: 'truncate', children: [`${miss.task}: ${miss.reason}`] }),
    ]);

  if (review.mode === 'diff')
    line('file-all', [toggle('file-all-btn', 'All files', !review.file, () => pickFile($, null))]);
  const shownFiles = review.showAllFiles ? files : files.slice(0, MAX_FILES);
  for (const f of shownFiles) {
    const mark = { added: 'A', deleted: 'D', renamed: 'R' }[f.status] ?? 'M';
    const warn = f.scope === 'outside' ? ' ⚠ outside files:' : '';
    const who = data.kind === 'group' ? ` · ${f.task}` : '';
    line('file-' + f.task + '-' + f.path, [
      toggle('pick-' + f.task + '-' + f.path, `${mark} ${f.path}`, review.file === f.path, () =>
        pickFile($, f.path),
      ),
      Text({
        color: f.scope === 'outside' ? C.amb : C.mut,
        wrap: 'truncate',
        children: [
          `+${f.added} −${f.removed}${f.uncommitted ? ' · uncommitted' : ''}${who}${warn}`,
        ],
      }),
    ]);
  }
  if (files.length > MAX_FILES)
    line('files-more', [
      Button({
        key: 'files-more-btn',
        label: pad(review.showAllFiles ? 'fewer' : `${files.length - MAX_FILES} more`),
        plain: true,
        onPress: () => {
          review.showAllFiles = !review.showAllFiles;
          $.ui.invalidate('ui.render');
        },
      }),
    ]);

  if (review.mode === 'diff') {
    const commits = data?.commits ?? [];
    line('commits-all', [
      toggle('commit-all', 'All changes', !review.commit, () => pickCommit($, null)),
      Text({ color: C.mut, children: [commits.length > 1 ? 'or step through a commit:' : ''] }),
    ]);
    for (const c of commits.slice(0, MAX_COMMITS))
      line('commit-' + c.short, [
        toggle('commit-btn-' + c.short, `${c.short} ${c.subject}`, review.commit === c.sha, () =>
          pickCommit($, c.sha),
        ),
        Text({
          color: C.faint,
          wrap: 'truncate',
          children: [c.when + (data.kind === 'group' ? ' · ' + c.task : '')],
        }),
      ]);
  }

  line('search', [
    Input({
      key: 'review-search',
      placeholder: 'Search the code on the branch',
      submitLabel: 'Search',
      onSubmit: (text) => searchCode($, text),
    }),
  ]);
  if (review.hits) {
    if (!review.hits.hits.length)
      line('hits-none', [Text({ color: C.mut, children: ['No match on the branch'] })]);
    review.hits.hits.slice(0, MAX_HITS).forEach((hit, i) =>
      line('hit-' + i, [
        Button({
          key: 'hit-btn-' + i,
          label: pad(`${hit.path}:${hit.line}`),
          plain: true,
          onPress: () => openHit($, hit),
        }),
        Text({ color: C.mut, wrap: 'truncate', children: [hit.text] }),
      ]),
    );
  }

  const open = data?.suggestions ?? [];
  if (review.file)
    line('suggest', [
      Input({
        key: 'review-suggest',
        placeholder: `Suggest a change to ${review.file} — "42: use the helper"`,
        submitLabel: 'Suggest',
        onSubmit: (text) => suggestChange($, text),
      }),
    ]);
  if (open.length) {
    const ids = [...new Set(open.map((s) => s.task))];
    line('suggestions', [
      Text({
        color: C.amb,
        children: [`${open.length} suggestion${open.length > 1 ? 's' : ''} waiting for the fixer`],
      }),
      Button({
        key: 'apply-fixes',
        label: 'Apply',
        variant: 'primary',
        onPress: () => applyFixes($, ids),
      }),
    ]);
  }
  head.push(
    Text({
      key: 'review-rule',
      color: C.border,
      wrap: 'truncate',
      children: ['─'.repeat(Math.max(inner, 1))],
    }),
  );

  // The window: as many rows as the pane leaves under the header, scrolled by the ui.scroll hook.
  reviewHeader = head.length + (head.length - 1) * S.xs + 1;
  const count = Math.max(bodyRows - reviewHeader - 2, 8);
  reviewCount = count;
  const rows = reviewRows();
  review.top = nextTop(review.top, 0, rows.length, count);
  const body = [];
  if (!rows.length)
    body.push(Text({ color: C.mut, children: [data ? 'Nothing changed here yet' : 'Loading…'] }));
  else if (review.mode === 'file') {
    const slice = rows.slice(review.top, review.top + count);
    body.push(
      Code({
        key: 'review-code',
        source: slice.map((r) => r.text).join('\n'),
        path: review.file,
        startLine: review.top + 1,
        wrap: 'truncate-end',
      }),
    );
  } else {
    windowParts(rows, review.top, count).forEach((part, i) =>
      body.push(
        part.kind === 'file'
          ? Text({
              key: 'part-' + i,
              bold: true,
              color: C.ink,
              wrap: 'truncate',
              children: [part.path],
            })
          : Code({
              key: 'part-' + i,
              source: part.source,
              path: part.path,
              format: 'diff',
              wrap: 'truncate-end',
            }),
      ),
    );
  }
  const shown = rows.length
    ? `${review.top + 1}–${Math.min(review.top + count, rows.length)} of ${rows.length}`
    : '';
  body.push(Text({ key: 'review-pos', color: C.faint, children: [shown] }));
  return [
    Box({ key: 'review-head', flexDirection: 'column', rowGap: S.xs, children: head }),
    ...body,
  ];
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

// One block per list item, numbered step or paragraph, so a multi-line step reads as one thing.
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

const where = (ref) =>
  typeof ref === 'string'
    ? ref
    : `${ref.path}${ref.line ? `:${ref.line}` : ''}${ref.name ? ` ${ref.name}` : ''}`;

const firstSentence = (text) => /^.*?(?:[.!?](?=\s)|$)/s.exec(text.trim())[0].replace(/\s+/g, ' ');

// The group page's body: a tab row, then the brief or the way into the diffs. Kept flat for Desktop's node limit.
const groupBody = ($, { Box, Text, Button }, group) => {
  const redraw = () => $.ui.invalidate('ui.render');
  const brief = [];
  const heading = (text) => brief.push(Text({ bold: true, color: C.ink, children: [text] }));
  const lines = (title, items) => {
    if (!items.length) return;
    heading(title);
    for (const item of items) brief.push(Text({ children: [item] }));
  };
  if (group.summary) brief.push(Text({ children: [group.summary] }));
  lines('Plan', [group.direction, ...group.target.map(where)].filter(Boolean));
  lines(
    'Not doing',
    group.rejected.map((r) => (typeof r === 'string' ? r : `${r.option} — ${r.why}`)),
  );
  lines('You decided', group.decided);
  lines('Exploring', group.exploring);
  const challenge = group.challenge;
  if (challenge?.skipped) lines('Challenge', ['skipped: ' + challenge.skipped]);
  else if (challenge)
    lines(
      'Challenge',
      (challenge.points ?? []).map((p) => `${p.q} → ${p.answer ?? 'unanswered'}`),
    );
  lines('Questions', (group.raised ?? []).filter((r) => !r.answer).map(raisedText));
  heading('Tasks');
  for (const task of group.tasks) {
    const [mark, markColor] = markOf(board.statuses[task.status] ?? {});
    brief.push(
      twoLine(
        { Box },
        'grouptask-' + task.id,
        [
          Text({ color: markColor, children: [mark] }),
          Button({
            key: 'open-' + task.id,
            label: pad(`${task.id}  ${task.title}`),
            plain: true,
            onPress: () => select($, task.id),
          }),
        ],
        [Text({ dimColor: true, children: [firstSentence(task.goal ?? '')] })],
      ),
    );
  }
  if (needsApproval(group)) brief.push(approveRow($, { Text, Button }, group));

  const built = group.tasks.filter((t) => !['draft', 'approved'].includes(t.status));
  const diffs = built.length
    ? [
        Text({ children: [`${built.length} task(s) with changes`] }),
        Button({
          key: 'review-group',
          label: pad('Open the diffs'),
          plain: true,
          onPress: () => openReview($, group.slug, group.title),
        }),
      ]
    : [Text({ color: C.mut, children: ['Nothing built yet'] })];

  const tabs = Box({
    flexDirection: 'row',
    columnGap: S.sm,
    children: [
      ['brief', 'Brief'],
      ['review', 'Review'],
    ].map(([name, label]) =>
      Box({
        key: 'gtab-box-' + name,
        borderStyle: 'round',
        borderColor: groupTab === name ? C.border : C.cardBorder,
        backgroundColor: groupTab === name ? C.card : C.well,
        paddingX: S.xs,
        hover: { borderColor: C.border },
        children: [
          Button({
            key: 'gtab-' + name,
            label: pad(label),
            plain: true,
            dimColor: groupTab !== name,
            onPress: () => {
              groupTab = name;
              redraw();
            },
          }),
        ],
      }),
    ),
  });
  return Box({
    flexDirection: 'column',
    rowGap: S.sm,
    children: [tabs, ...(groupTab === 'brief' ? brief : diffs)],
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

  // The review pane scrolls its code window itself, under a header that stays put.
  on('ui.scroll', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== REVIEW_PANE || !review) return next(e);
    if (e.pointer && e.pointer.row < reviewHeader) return next(e);
    const top = nextTop(review.top, e.by, reviewRows().length, reviewCount);
    if (top === review.top) return next(e);
    review.top = top;
    $.ui.invalidate('ui.render');
    return {};
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
    if (e.requestId === REVIEW_PANE) {
      const ui = $.ui.resolve(e);
      if (!review)
        return ui.Text({
          color: C.mut,
          children: ['Open a review from a task or a group in the pit wall.'],
        });
      const width = e.props.bodyColumns ?? 80;
      return ui.Box({
        flexDirection: 'column',
        padding: S.sm,
        rowGap: 0,
        children: reviewBody($, ui, {
          bodyRows: e.props.scroll?.bodyRows ?? 40,
          inner: width - S.sm * 2,
        }),
      });
    }
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
        [
          Button({
            key: 'view-groups',
            label: pad('Groups'),
            ...(wallView === 'groups' ? {} : { plain: true }),
            onPress: () => {
              wallView = 'groups';
              redraw();
            },
          }),
          Button({
            key: 'view-crew',
            label: pad('Crew'),
            ...(wallView === 'crew' ? {} : { plain: true }),
            onPress: () => {
              wallView = 'crew';
              redraw();
            },
          }),
        ],
      );
      const byGroup = wallView === 'groups' && board?.works?.length;
      const pvLine = boardError ? null : previewLine($, ui);
      return frame([
        header,
        ...(pvLine ? [pvLine] : []),
        boardError
          ? Text({ color: C.amb, children: [boardError] })
          : byGroup
            ? groupList($, ui)
            : boardList($, ui, inner),
      ]);
    }

    const group = selectedGroup && buildGroups(board).find((g) => g.slug === selectedGroup);
    if (group) {
      const counts = groupCounts(board, group);
      const facts = [
        group.shape,
        `${counts.done}/${group.tasks.length} done`,
        group.pilot && 'pilot ' + group.pilot,
      ].filter(Boolean);
      const header = Box({
        flexDirection: 'column',
        rowGap: S.xs,
        children: [
          Text({ bold: true, color: C.ink, children: [group.title] }),
          Text({ dimColor: true, children: [facts.join(' · ')] }),
        ],
      });
      return frame(window('group-window', header, groupBody($, ui, group)));
    }

    if (!doc) await loadDoc($);
    const task = selectedTask();
    const status = task?.status;
    const statusMeta = board?.statuses?.[status] ?? {};
    const why = statusMeta.waitsOnUser ? waitText(task, statusMeta) : '';
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
        ? [Button({ key: 'sendback', label: 'Send back', onPress: () => sendBack($) })]
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
      ...(task?.branch && board?.preview && !['draft', 'approved'].includes(status)
        ? [
            Button({
              key: 'preview-task',
              label: pad('Preview'),
              plain: true,
              onPress: () => preview($, [task.id]),
            }),
          ]
        : []),
      ...(task?.branch && !['draft', 'approved'].includes(status)
        ? [
            Button({
              key: 'review-task',
              label: pad('Review changes'),
              plain: true,
              onPress: () => openReview($, task.id, `${task.id} ${task.title}`),
            }),
          ]
        : []),
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
        ...(why ? [Text({ color: C.amb, children: ['⚑ ' + why] })] : []),
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
