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
        ...(meta.waitsOnUser
          ? [Text({ color: C.amb, children: ['⚑ ' + waitText(task, meta)] })]
          : []),
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
    const summary = [
      group.shape,
      `${counts.done}/${group.tasks.length} done`,
      counts.running ? `${counts.running} running` : '',
      counts.waiting ? `⚑ ${counts.waiting}` : '',
      counts.questions ? `? ${counts.questions}` : '',
    ].filter(Boolean);
    children.push(
      Box({
        key: 'grouprow-' + (group.slug || 'none'),
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: S.sm,
        alignItems: 'center',
        flexShrink: 0,
        children: [
          Button({
            key: 'group-' + (group.slug || 'none'),
            label: pad(`${isOpen ? '▾' : '▸'} ${group.title}`),
            plain: true,
            onPress: () => {
              expanded[group.slug] = !isOpen;
              $.ui.invalidate('ui.render');
            },
          }),
          Text({
            color: counts.waiting || counts.questions ? C.amb : C.mut,
            children: [summary.join(' · ')],
          }),
        ],
      }),
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
    }
    if (group.slug && !group.approved) {
      body.push(
        group.problems.length
          ? Text({ color: C.mut, children: ['Not ready: ' + group.problems.join('; ')] })
          : Button({
              key: 'approve-' + group.slug,
              label: 'Approve group',
              variant: 'primary',
              onPress: () => approveGroup($, group),
            }),
      );
    }
    for (const r of group.raised ?? []) {
      if (r.answer) continue;
      const holds = r.affects?.length ? ` · holds ${r.affects.join(', ')}` : '';
      body.push(
        Text({
          key: `raised-${group.slug}-${r.ref}`,
          color: C.amb,
          children: [`? ${r.ref} ${r.from ?? 'reviewer'} on ${r.task}: ${r.q}${holds}`],
        }),
      );
    }
    group.tasks.forEach((task, i) => {
      const meta = board.statuses[task.status] ?? {};
      const [mark, markColor] = markOf(meta);
      const isPilot = group.pilot === task.id;
      const canMove = group.slug && (task.status === 'draft' || task.status === 'approved');
      body.push(
        Box({
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
            Text({ color: sectionOf(task.status).color, children: [task.status] }),
            ...(isPilot ? [Text({ color: C.clay, children: ['★ pilot'] })] : []),
            ...(meta.waitsOnUser
              ? [Text({ color: C.amb, children: ['⚑ ' + waitText(task, meta)] })]
              : []),
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
        }),
      );
    });
    children.push(
      Box({ flexDirection: 'column', rowGap: S.xs, paddingLeft: S.md, children: body }),
    );
  }
  return Box({ flexDirection: 'column', rowGap: S.xs, children });
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
      text: `Apply the open suggestions on task ${id} with \`npx crew fix ${id}\`, and tell me what the fixer did`,
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
  reviewHeader = head.length + 1;
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
  return [...head, ...body];
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
      return frame([
        header,
        boardError
          ? Text({ color: C.amb, children: [boardError] })
          : byGroup
            ? groupList($, ui)
            : boardList($, ui),
      ]);
    }

    if (!doc) await loadDoc($);
    const task = selectedTask();
    const status = task?.status;
    const statusMeta = board?.statuses?.[status] ?? {};
    const waiting = statusMeta.waitsOnUser && waitText(task, statusMeta);
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
