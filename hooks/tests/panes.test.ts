import { expect, mock, test } from 'claude-code/testing';

const SPEC = `---
id: 031
status: draft
env: laptop
branch: crew/031-x
files:
  - src/a.ts
  - src/new.ts
---

# Holding OK opens a menu

## Goal
Holding OK opens a menu.

## Why now
Asked for on the canvas.

## Approach
1. First step in \`src/a.ts\`
   continues here.
2. Second step

## Out of scope
- The rail

## Review rounds
Round 1 passed.
`;

const pane = (requestId: string) =>
  ({
    plugin: 'crew',
    component: 'Pane',
    requestId,
    viewport: { columns: 200, rows: 150 },
    props: {
      title: requestId,
      isFocused: true,
      bodyColumns: 160,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 140 },
      view: {},
    },
  }) as const;

const BOARD = {
  project: 'Test',
  root: '/repo',
  statuses: {
    draft: { waitsOnUser: 'spec needs your approval' },
    approved: {},
    building: { inFlight: true },
    review: { inFlight: true },
    blocked: { waitsOnUser: 'review rounds disagreed' },
    'pending-desktop': { waitsOnUser: 'only desktop can prove it', pendingEnv: 'desktop' },
    done: { terminal: true },
  },
  tasksDir: '/repo/.claude/tasks',
  tasks: [
    {
      id: '001',
      file: '.claude/tasks/001-first.md',
      title: 'First thing',
      status: 'draft',
      model: 'opus',
      files: [
        { path: 'src/a.ts', exists: true },
        { path: 'src/new.ts', exists: false },
      ],
    },
    {
      id: '002',
      file: '.claude/tasks/002-second.md',
      title: 'Second thing',
      status: 'building',
      model: 'sonnet',
      files: [],
    },
    ...['approved', 'review', 'blocked', 'pending-desktop', 'done'].map((status, i) => ({
      id: '00' + (i + 3),
      file: `.claude/tasks/00${i + 3}-${status}.md`,
      title: status + ' task',
      status,
      model: 'sonnet',
      files: [],
    })),
  ],
};

const planView = (layer: string) => ({
  layer,
  part: {
    id: 'p-x',
    label: 'Wall mod',
    status: 'extend',
    surface: [{ name: 'diagramItems', use: 'modify', verified: true }],
  },
  edges: [
    { from: 'p-in', to: 'p-x', label: 'board json' },
    { from: 'p-x', to: 'p-out', label: 'svg' },
  ],
  neighbours: [
    { id: 'p-in', label: 'Board command', status: 'exists' },
    { id: 'p-out', label: 'Desktop pane', status: 'new' },
  ],
});

const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};
const answer = (text: string) => ({ isAnswered: true, text, usage: USAGE });

// A fake crew: `board --json` answers from a board that `task` calls change, as the real files would.
// `complete` answers the model.
const stubs = (
  on: any,
  {
    boardRun,
    refuse,
    complete,
    status,
    taskFields,
    panes = ['crew-wall'],
  }: {
    panes?: string[];
    status?: string;
    taskFields?: Record<string, unknown>;
    boardRun?: any;
    refuse?: string;
    complete?: (e: any) => any;
  } = {},
) => {
  const board = structuredClone(BOARD);
  if (status) board.tasks[0].status = status;
  Object.assign(board.tasks[0], taskFields);
  // The mod reads the time to know how old its board is; a test moves this clock itself.
  const clock = mock.clock(on);
  const seen = {
    clock,
    calls: [] as any[],
    prompts: [] as any[],
    reads: [] as string[],
    submitted: [] as string[],
    toasts: [] as string[],
    opens: [] as any[],
    boardRuns: 0,
    listings: 0,
    // task file name → mtime, as the folder listing reports it; a test bumps one to say the file changed
    times: Object.fromEntries(board.tasks.map((t) => [t.file.split('/').pop()!, 1])) as Record<
      string,
      number
    >,
    panes,
  };
  on('model.complete', async ($: any, e: any) => {
    seen.prompts.push(e);
    return { value: complete ? await complete(e) : answer('{"reply":"Fine.","replacements":[]}') };
  });
  on('process.run', async ($: any, e: any) => {
    expect(e.argv[0]).toBe('node');
    expect(e.argv[1]).toMatch(/\/src\/cli\.js$/);
    const args = e.argv.slice(2);
    if (args[0] === 'board') {
      seen.boardRuns++;
      return { value: boardRun ?? { exitCode: 0, stdout: JSON.stringify(board), stderr: '' } };
    }
    if (args[0] === 'plan') {
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify([planView('architecture'), planView('feature')]),
          stderr: '',
        },
      };
    }
    seen.calls.push({ args, stdin: e.init?.stdin && JSON.parse(e.init.stdin) });
    if (refuse) return { value: { exitCode: 1, stdout: '', stderr: refuse + '\nmore' } };
    const task = board.tasks.find((t) => t.id === args[1])!;
    if (args[2] === 'approve') task.status = 'approved';
    if (args[2] === 'signoff') task.status = 'done';
    if (args[2] === 'sendback') task.status = 'approved';
    if (args[2] === 'set') (task as any)[args[3]] = args[4];
    return { value: { exitCode: 0, stdout: '{}', stderr: '' } };
  });
  on('fs.read', ($: any, e: any) => {
    seen.reads.push(e.path);
    return { value: SPEC };
  });
  on('prompt.submit', ($: any, e: any) => {
    seen.submitted.push(e.text);
    return { text: e.text };
  });
  on('ui.toast', ($: any, e: any) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  on('ui.open', ($: any, e: any) => {
    seen.opens.push(e);
    return { value: { isPlaced: true } };
  });
  on('ui.scroll', () => ({}));
  // What the engine answers beneath the plugin when a session starts.
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }));
  on('command.register', () => ({ value: undefined }));
  on('ui.panes', () => ({
    value: seen.panes.map((id) => ({
      id,
      title: id,
      isShown: true,
      isFocused: false,
      isPlaced: true,
    })),
  }));
  on('fs.list', () => {
    seen.listings++;
    return {
      value: Object.entries(seen.times).map(([name, mtimeMs]) => ({
        name,
        kind: 'file',
        size: 100,
        mtimeMs,
        isLink: false,
      })),
    };
  });
  return seen;
};

test('tabs: spec first, context and build record on their own tabs', async ($, on) => {
  stubs(on);
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('crew-spec'), surface });
    expect(
      await ui.find({ type: 'Markdown', text: /First step in `src\/a.ts`\n {3}continues here/ }),
    ).toBeDefined();
    expect(await ui.find({ key: 'edit-btn-2-0' })).toBeDefined();
    expect(await ui.find({ type: 'Markdown', text: /Asked for on the canvas/ })).toBeUndefined();
    await ui.press({ key: 'tab-context' });
    expect(await ui.find({ type: 'Markdown', text: /Asked for on the canvas/ })).toBeDefined();
    expect(await ui.find({ key: 'edit-btn-2-0' })).toBeUndefined();
    await ui.press({ key: 'tab-record' });
    expect(await ui.find({ type: 'Markdown', text: /Round 1 passed/ })).toBeDefined();
    await ui.press({ key: 'tab-agreement' });
    await ui.unmount();
  }
});

test('the spec pane has its header, the controls and four tabs, and no chat or ? controls', async ($, on) => {
  stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  expect(await ui.find({ type: 'Markdown', text: '## Holding OK opens a menu' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'draft' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: '⚑ spec needs your approval' })).toBeDefined();
  expect(
    await ui.find({ type: 'Text', text: '#031 · laptop · 2 files · crew/031-x' }),
  ).toBeDefined();
  for (const key of [
    'column',
    'model',
    'approve',
    'tab-agreement',
    'tab-context',
    'tab-record',
    'tab-diagram',
  ])
    expect(await ui.find({ key })).toBeDefined();
  for (const key of ['composer', 'ask-0-0', 'ask-diagram'])
    expect(await ui.find({ key })).toBeUndefined();
  await ui.press({ key: 'tab-context' });
  expect(await ui.find({ key: 'ask-2-0' })).toBeUndefined();
  await ui.press({ key: 'tab-diagram' });
  expect(await ui.find({ key: 'ask-diagram' })).toBeUndefined();
  await ui.unmount();
});

test('the board pane holds the crew list alone, with no spec window or its buttons', async ($, on) => {
  stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  expect(await ui.find({ key: 'row-001' })).toBeDefined();
  for (const key of ['spec-window', 'full', 'pop-out', 'close-spec', 'composer'])
    expect(await ui.find({ key })).toBeUndefined();
  expect(await ui.find({ type: 'Markdown', text: /Second step/ })).toBeUndefined();
  await ui.unmount();
});

test('the spec is the selected task file, read from the board root', async ($, on) => {
  const seen = stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  expect(await ui.find({ type: 'Markdown', text: /Holding OK opens a menu/ })).toBeDefined();
  expect(seen.reads).toContain('/repo/.claude/tasks/001-first.md');
  await ui.unmount();
});

test('edit, remove, add and remove-section write the task file through crew task edit', async ($, on) => {
  const seen = stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  const edit = ['task', '001', 'edit'];
  await ui.press({ key: 'edit-btn-2-1' });
  await ui.input({ key: 'edit-2-1', text: 'Second step, reworded' });
  await ui.press({ key: 'rm-2-0' });
  await ui.press({ key: 'add-3' });
  await ui.input({ key: 'new-3', text: 'Scheduled exports' });
  await ui.press({ key: 'rm-section-3' });
  expect(seen.calls).toEqual([
    { args: edit, stdin: { old: '2. Second step', new: '2. Second step, reworded' } },
    { args: edit, stdin: { old: '1. First step in `src/a.ts`\n   continues here.', new: '' } },
    { args: edit, stdin: { section: 'Out of scope', append: 'Scheduled exports' } },
    { args: edit, stdin: { old: '- The rail', new: '' } },
  ]);
  expect(await ui.find({ key: 'restore-2-0' })).toBeUndefined();
  await ui.press({ key: 'ok-0-0' });
  expect(seen.calls.length).toBe(4);
  await ui.unmount();
});

test('the column and model dropdowns set status and model', async ($, on) => {
  const seen = stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.select({ key: 'model', value: 'haiku' });
  await ui.select({ key: 'column', value: 'building' });
  expect(seen.calls.map((c) => c.args)).toEqual([
    ['task', '001', 'set', 'model', 'haiku'],
    ['task', '001', 'set', 'status', 'building'],
  ]);
  expect((await ui.find({ key: 'column' }))?.props.value).toBe('building');
  expect(await ui.find({ type: 'Text', text: '● Running' })).toBeDefined();
  await ui.unmount();
});

test('approve writes approval and asks the session to run it, with a manual start as the fallback', async ($, on) => {
  const seen = stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  expect(await ui.find({ key: 'signoff' })).toBeUndefined();
  expect(await ui.find({ key: 'sendback' })).toBeUndefined();
  await ui.press({ key: 'approve' });
  expect(seen.calls.map((c) => c.args)).toEqual([['task', '001', 'approve']]);
  expect(seen.submitted).toEqual(['Run task 001 with /crew:crew-run']);
  expect(await ui.find({ type: 'Text', text: 'Starting…' })).toBeDefined();
  await ui.press({ key: 'start' });
  expect(seen.submitted).toEqual([
    'Run task 001 with /crew:crew-run',
    'Run task 001 with /crew:crew-run',
  ]);
  await ui.unmount();
});

test('a refused write toasts the reason and leaves the spec as the file has it', async ($, on) => {
  const seen = stubs(on, { refuse: 'task: that text is no longer in the spec' });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.press({ key: 'rm-2-1' });
  expect(seen.toasts).toEqual(['task: that text is no longer in the spec']);
  expect(await ui.find({ type: 'Markdown', text: '2. Second step' })).toBeDefined();
  await ui.press({ key: 'approve' });
  expect(seen.submitted).toEqual([]);
  expect(await ui.find({ key: 'approve' })).toBeDefined();
  await ui.unmount();
});

test('the board lists tasks under Scout, Worker, Reviewer and Done, flagging those waiting on the person', async ($, on) => {
  stubs(on);
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('crew-wall'), surface });
    expect(await ui.find({ type: 'Text', text: '7 tasks · 3 waiting on you' })).toBeDefined();
    const sections = (
      await ui.findAll({ type: 'Text', text: /^(Scout|Worker|Reviewer|Done) · \d+$/ })
    ).map((el: any) => el.children.join(''));
    expect(sections).toEqual(['Scout · 1', 'Worker · 2', 'Reviewer · 2', 'Done · 2']);
    const rows = (await ui.findAll({ type: 'Button' }))
      .filter((el: any) => String(el.key).startsWith('open-'))
      .map((el: any) => el.props.label.trim());
    expect(rows).toEqual([
      '001  First thing',
      '002  Second thing',
      '003  approved task',
      '004  review task',
      '005  blocked task',
      '006  pending-desktop task',
      '007  done task',
    ]);
    expect(await ui.find({ type: 'Text', text: '⚑ review rounds disagreed' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: '⚑ only desktop can prove it' })).toBeDefined();
    await ui.unmount();
  }
});

test('an empty section is left out, and Done keeps the five newest finished tasks', async ($, on) => {
  const crowded = structuredClone(BOARD);
  crowded.tasks = [
    crowded.tasks[1],
    ...['10', '11', '12', '13', '14', '15'].map((id) => ({
      id,
      file: `.claude/tasks/${id}-finished.md`,
      title: 'Finished ' + id,
      status: 'done',
      model: 'sonnet',
      files: [],
    })),
  ];
  stubs(on, { boardRun: { exitCode: 0, stdout: JSON.stringify(crowded), stderr: '' } });
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  const texts = async (pattern: RegExp) =>
    (await ui.findAll({ type: 'Text', text: pattern })).map((el: any) => el.children.join(''));
  expect(await texts(/^(Scout|Worker|Reviewer|Done) · \d+$/)).toEqual(['Worker · 1', 'Done · 5']);
  expect(await ui.find({ key: 'open-10' })).toBeUndefined();
  for (const id of ['15', '14', '13', '12', '11'])
    expect(await ui.find({ key: 'open-' + id })).toBeDefined();
  await ui.unmount();
});

test('clicking a row opens that task in the crew-spec pane', async ($, on) => {
  const seen = stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  await ui.press({ key: 'open-004' });
  expect(seen.opens).toEqual([
    expect.objectContaining({ id: 'crew-spec', title: '004 · review task' }),
  ]);
  await ui.unmount();
  const spec = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  expect(seen.reads).toContain('/repo/.claude/tasks/004-review.md');
  await spec.unmount();
});

test('no view draws an Svg or a Client, on either surface', async ($, on) => {
  stubs(on, {
    complete: () => answer('{"nodes":[{"id":"a","label":"OK","kind":"start"}],"edges":[]}'),
  });
  for (const surface of ['terminal', 'desktop'] as const) {
    const wall = await $.ui.mount({ ...pane('crew-wall'), surface });
    expect(await wall.findAll({ type: 'Svg' })).toEqual([]);
    expect(await wall.findAll({ type: 'Client' })).toEqual([]);
    await wall.unmount();
    const spec = await $.ui.mount({ ...pane('crew-spec'), surface });
    for (const key of ['tab-agreement', 'tab-context', 'tab-record', 'tab-diagram']) {
      await spec.press({ key });
      expect(await spec.findAll({ type: 'Svg' })).toEqual([]);
    }
    for (const key of ['diagram-change', 'diagram-flow']) {
      await spec.press({ key });
      expect(await spec.findAll({ type: 'Svg' })).toEqual([]);
    }
    await spec.unmount();
  }
});

test('a failing crew call draws one error line instead of an empty board', async ($, on) => {
  stubs(on, { boardRun: { exitCode: 1, stdout: '', stderr: 'crew: not found\nmore' } });
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  expect(
    await ui.find({ type: 'Text', text: 'Could not read the board: crew: not found' }),
  ).toBeDefined();
  expect(await ui.find({ key: 'open-001' })).toBeUndefined();
  await ui.unmount();
});

test('diagrams: the change map lists steps against files, and the flow comes from the model', async ($, on) => {
  stubs(on, {
    complete: () =>
      answer(
        'Here: {"nodes":[{"id":"a","label":"OK pressed","kind":"start"},{"id":"b","label":"Held 500ms?","kind":"decision"},{"id":"c","label":"Open menu","kind":"end"}],"edges":[{"from":"a","to":"b"},{"from":"b","to":"c","label":"yes"}]}',
      ),
  });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.press({ key: 'tab-diagram' });
  const view = async () =>
    ((await ui.find({ key: 'diagram-view' }))?.children?.[0] as any)?.props.text as string;
  expect(await view()).toContain('**1. First step in src/a.ts** → `src/a.ts`');
  expect(await view()).toContain('**2. Second step** → no file named');
  expect(await ui.find({ type: 'Text', text: /No step names src\/new.ts/ })).toBeDefined();
  await ui.press({ key: 'diagram-flow' });
  await ui.press({ key: 'generate-flow' });
  expect(await view()).toContain('- OK pressed → Held 500ms?');
  expect(await view()).toContain('- Held 500ms? → Open menu (yes)');
  await ui.unmount();
});

test('diagrams: a task with a part gets Architecture and Feature views, one without gets the pointer', async ($, on) => {
  stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.press({ key: 'tab-diagram' });
  expect(await ui.find({ key: 'diagram-architecture' })).toBeUndefined();
  expect(await ui.find({ type: 'Text', text: /feature-map/ })).toBeDefined();
  await ui.unmount();
});

test('diagrams: a task with a part gets Architecture and Feature views of it and its neighbours', async ($, on) => {
  const withPart = structuredClone(BOARD);
  (withPart.tasks[0] as any).part = 'p-x';
  stubs(on, { boardRun: { exitCode: 0, stdout: JSON.stringify(withPart), stderr: '' } });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.press({ key: 'tab-diagram' });
  const view = async () =>
    ((await ui.find({ key: 'diagram-view' }))?.children?.[0] as any)?.props.text as string;
  await ui.press({ key: 'diagram-architecture' });
  expect(await view()).toContain('**Wall mod**');
  expect(await view()).toContain('- ← Board command · board json');
  expect(await view()).toContain('- → Desktop pane · svg');
  await ui.press({ key: 'diagram-feature' });
  expect(await view()).toContain('**Wall mod** _(extend)_');
  expect(await view()).toContain('- ✔ `diagramItems` · modify');
  expect(await view()).toContain('- → Desktop pane _(new)_ · svg');
  await ui.unmount();
});

test('sign off appears for a pending task, records it and asks the session to close it', async ($, on) => {
  const seen = stubs(on, { status: 'pending-desktop' });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  expect(await ui.find({ key: 'signoff' })).toBeDefined();
  expect(await ui.find({ key: 'sendback' })).toBeUndefined();
  expect(await ui.find({ key: 'approve' })).toBeUndefined();
  await ui.press({ key: 'signoff' });
  expect(seen.calls.map((c) => c.args)).toEqual([['task', '001', 'signoff']]);
  expect(seen.submitted).toEqual(['Close task 001 with /crew:crew-close']);
  await ui.unmount();
});

test('a blocked task shows its reason and Send back', async ($, on) => {
  const seen = stubs(on, { status: 'blocked' });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  expect(await ui.find({ type: 'Text', text: 'review rounds disagreed' })).toBeDefined();
  expect(await ui.find({ key: 'signoff' })).toBeUndefined();
  await ui.press({ key: 'sendback' });
  expect(seen.calls.map((c) => c.args)).toEqual([['task', '001', 'sendback']]);
  expect(seen.submitted).toEqual([]);
  await ui.unmount();
});

test('a blocked task with a reason says who stopped it and why, on its row and its page', async ($, on) => {
  stubs(on, {
    status: 'blocked',
    taskFields: { blocked: 'wraps post_save instead of replacing it', blockedBy: 'reviewer' },
  });
  const line = '⚑ reviewer: wraps post_save instead of replacing it';
  const wall = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  expect(await wall.find({ type: 'Text', text: line })).toBeDefined();
  await wall.unmount();
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  expect(await ui.find({ type: 'Text', text: line })).toBeDefined();
  await ui.unmount();
});

test('a done or building task offers neither', async ($, on) => {
  stubs(on, { status: 'done' });
  for (const key of ['open-001', 'open-002']) {
    const wall = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
    await wall.press({ key });
    await wall.unmount();
    const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
    expect(await ui.find({ key: 'signoff' })).toBeUndefined();
    expect(await ui.find({ key: 'sendback' })).toBeUndefined();
    await ui.unmount();
  }
});

test('the session opens the pit wall where crew is set up, and nothing where it is not', async ($, on) => {
  const seen = stubs(on);
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true });
  expect(seen.opens).toEqual([expect.objectContaining({ id: 'crew-wall', title: 'Pit wall' })]);
  expect(seen.opens[0].focus).toBeUndefined();
});

test('with crew missing, the session starts without opening anything', async ($, on) => {
  const seen = stubs(on, {
    boardRun: { exitCode: 1, stdout: '', stderr: 'no .claude/crew.config.json' },
  });
  await $.session.start({ cwd: '/elsewhere', surface: 'desktop', isInteractive: true });
  expect(seen.opens).toEqual([]);
});

test('with no pit wall pane open, the timer does no work at all', async ($, on) => {
  const seen = stubs(on, { panes: [] });
  const { clock } = seen;
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true });
  const runs = seen.boardRuns;
  await clock.advance(10 * 60_000);
  expect(seen.boardRuns).toBe(runs);
  expect(seen.listings).toBe(0);
});

test('while open, an unchanged task folder costs a listing, and a changed file reloads the board', async ($, on) => {
  const seen = stubs(on);
  const { clock } = seen;
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true });
  await clock.advance(15_000); // the first check records the folder
  const runs = seen.boardRuns;
  const listings = seen.listings;
  await clock.advance(45_000);
  expect(seen.listings).toBe(listings + 3);
  expect(seen.boardRuns).toBe(runs);
  seen.times['002-second.md'] = 2;
  await clock.advance(15_000);
  expect(seen.boardRuns).toBe(runs + 1);
});

test('a quiet folder is still reloaded once the board is two minutes old', async ($, on) => {
  const seen = stubs(on);
  const { clock } = seen;
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true });
  await clock.advance(15_000);
  const runs = seen.boardRuns;
  await clock.advance(120_000); // two minutes old exactly: not yet past it
  expect(seen.boardRuns).toBe(runs);
  await clock.advance(15_000); // the next check finds it older, and reloads
  expect(seen.boardRuns).toBe(runs + 1);
});
