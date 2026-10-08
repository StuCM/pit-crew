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
const CHAT_KEY = 'chat:/repo:001';

// A fake crew: `board --json` answers from a board that `task` calls change, as the real files would.
// `complete` answers the model; `slowEdit` holds each `task … edit` until the clock moves a second.
const stubs = (
  on: any,
  {
    boardRun,
    refuse,
    complete,
    slowEdit,
    status,
  }: {
    status?: string;
    boardRun?: any;
    refuse?: string;
    complete?: (e: any) => any;
    slowEdit?: boolean;
  } = {},
) => {
  const board = structuredClone(BOARD);
  if (status) board.tasks[0].status = status;
  const seen = {
    clock: mock.clock(on),
    store: new Map<string, unknown>([
      [
        CHAT_KEY,
        [
          { who: 'you', text: 'Earlier question' },
          { who: 'planner', text: 'Earlier answer', suggestions: [] },
        ],
      ],
    ]),
    calls: [] as any[],
    prompts: [] as any[],
    reads: [] as string[],
    submitted: [] as string[],
    toasts: [] as string[],
    opens: [] as any[],
  };
  on('store.get', ($: any, e: any) => ({ value: seen.store.get(e.key) }));
  on('store.set', ($: any, e: any) => {
    seen.store.set(e.key, e.value);
    return { value: undefined };
  });
  on('model.complete', async ($: any, e: any) => {
    seen.prompts.push(e);
    return { value: complete ? await complete(e) : answer('{"reply":"Fine.","replacements":[]}') };
  });
  on('process.run', async ($: any, e: any) => {
    const args = e.argv.slice(3);
    if (args[0] === 'board')
      return { value: boardRun ?? { exitCode: 0, stdout: JSON.stringify(board), stderr: '' } };
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
    if (slowEdit && args[2] === 'edit') await seen.clock.sleep(1000);
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
  await ui.press({ key: 'ask-0-0' });
  expect(await ui.find({ type: 'Markdown', text: /Can we talk this one through/ })).toBeDefined();
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

const svgs = async (ui: any) =>
  (await ui.findAll({ type: 'Svg' })).map((el: any) => el.props as { source: string; alt: string });

test('the board lists tasks under Scout, Worker, Reviewer and Done, flagging those waiting on the person', async ($, on) => {
  stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  expect(await ui.find({ type: 'Text', text: '7 tasks · 3 waiting on you' })).toBeDefined();
  expect((await svgs(ui)).map((s) => s.alt)).toEqual([
    'Scout, 1',
    '001 First thing: draft · ⚑ spec needs your approval',
    'Worker, 2',
    '002 Second thing: building',
    '003 approved task: approved',
    'Reviewer, 2',
    '004 review task: review',
    '005 blocked task: blocked · ⚑ review rounds disagreed',
    'Done, 2',
    '006 pending-desktop task: pending-desktop · ⚑ only desktop can prove it',
    '007 done task: done',
  ]);
  const row = async (id: string) =>
    ((await ui.find({ key: 'row-' + id }))?.children?.[0] as any)?.props.source as string;
  expect(await row('005')).toContain('⚑ review rounds disagreed');
  expect(await row('002')).toContain('c-engineer run');
  expect(await row('003')).toContain('class="c-engineer"');
  expect(await row('004')).toContain('c-detective run');
  for (const { source } of await svgs(ui)) {
    expect(source).toContain('@media (prefers-color-scheme: dark){.t{fill:#ececec}');
    expect(source).toContain('prefers-reduced-motion');
    expect(source).not.toMatch(/\$\d/);
    expect(source.length).toBeLessThan(131072);
  }
  await ui.unmount();
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
  expect((await svgs(ui)).map((s) => s.alt.split(':')[0])).toEqual([
    'Worker, 1',
    '002 Second thing',
    'Done, 5',
    '15 Finished 15',
    '14 Finished 14',
    '13 Finished 13',
    '12 Finished 12',
    '11 Finished 11',
  ]);
  await ui.unmount();
});

test('clicking a row opens that task in the crew-spec pane', async ($, on) => {
  const seen = stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  expect((await ui.find({ key: 'card-004' }))?.props.props).toEqual({ id: '004' });
  await ui.post({ select: '004' }, { in: 'card-004' });
  expect(seen.opens).toEqual([
    expect.objectContaining({ id: 'crew-spec', title: '004 · review task' }),
  ]);
  await ui.unmount();
  const spec = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  expect(seen.reads).toContain('/repo/.claude/tasks/004-review.md');
  await spec.unmount();
});

test('the terminal draws the same sections as plain rows', async ($, on) => {
  stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'terminal' });
  expect(await ui.findAll({ type: 'Svg' })).toEqual([]);
  expect(await ui.find({ type: 'Text', text: 'Reviewer · 2' })).toBeDefined();
  expect(
    await ui.find({ type: 'Text', text: '001  First thing · ⚑ spec needs your approval' }),
  ).toBeDefined();
  expect(await ui.find({ key: 'card-007' })).toBeDefined();
  await ui.unmount();
});

test('a failing crew call draws one error line instead of an empty board', async ($, on) => {
  stubs(on, { boardRun: { exitCode: 1, stdout: '', stderr: 'crew: not found\nmore' } });
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  expect(
    await ui.find({ type: 'Text', text: 'Could not read the board: crew: not found' }),
  ).toBeDefined();
  expect(await ui.find({ key: 'card-001' })).toBeUndefined();
  await ui.unmount();
});

test('diagrams: the change map draws steps against files, and the flow comes from the model', async ($, on) => {
  stubs(on, {
    complete: () =>
      answer(
        'Here: {"nodes":[{"id":"a","label":"OK pressed","kind":"start"},{"id":"b","label":"Held 500ms?","kind":"decision"},{"id":"c","label":"Open menu","kind":"end"}],"edges":[{"from":"a","to":"b"},{"from":"b","to":"c","label":"yes"}]}',
      ),
  });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.press({ key: 'tab-diagram' });
  const svg = async () =>
    ((await ui.find({ key: 'diagram-view' }))?.children?.[0] as any)?.props.source as string;
  expect(await svg()).toContain('src/a.ts');
  expect(await svg()).toContain('+ src/new.ts');
  expect(await ui.find({ type: 'Text', text: /No step names src\/new.ts/ })).toBeDefined();
  await ui.press({ key: 'diagram-flow' });
  await ui.press({ key: 'generate-flow' });
  expect(await svg()).toContain('Held 500ms?');
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
  const svg = async () =>
    ((await ui.find({ key: 'diagram-view' }))?.children?.[0] as any)?.props.source as string;
  await ui.press({ key: 'diagram-architecture' });
  expect(await svg()).toContain('Wall mod');
  expect(await svg()).toContain('Board command');
  expect(await svg()).toContain('svg');
  await ui.press({ key: 'diagram-feature' });
  expect(await svg()).toContain('✔ diagramItems · modify');
  expect(await svg()).toContain('Desktop pane');
  await ui.unmount();
});

const reply = (out: object) => () => answer(JSON.stringify(out));

test('a plain question is answered from the spec and the thread, with no edit run', async ($, on) => {
  const seen = stubs(on, { complete: reply({ reply: 'Step two is clear.', replacements: [] }) });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  expect(await ui.find({ type: 'Markdown', text: 'Earlier answer' })).toBeDefined();
  await ui.post({ send: 'Is step two clear?' }, { in: 'composer' });
  expect(await ui.find({ type: 'Markdown', text: 'Step two is clear.' })).toBeDefined();
  expect(seen.calls).toEqual([]);
  expect(seen.prompts.length).toBe(1);
  const { model, effort, prompt } = seen.prompts[0];
  expect([model, effort]).toEqual(['sonnet', 'low']);
  expect(prompt).toContain('2. Second step');
  expect(prompt).toContain('planner: Earlier answer');
  expect(prompt).toContain('Is step two clear?');
  const saved = seen.store.get(CHAT_KEY) as any[];
  expect(saved.map((t) => t.text)).toEqual([
    'Earlier question',
    'Earlier answer',
    'Is step two clear?',
    'Step two is clear.',
  ]);
  await ui.unmount();
});

test('the status line reads the spec with elapsed seconds while the model works', async ($, on) => {
  const { clock } = stubs(on, {
    complete: async () => {
      await clock.sleep(5000);
      return answer('{"reply":"Done thinking.","replacements":[]}');
    },
  });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.post({ send: 'Anything missing?' }, { in: 'composer' });
  expect(await ui.find({ type: 'Text', text: 'Reading the spec… 0:00' })).toBeDefined();
  await clock.advance(4000);
  expect(await ui.find({ type: 'Text', text: 'Reading the spec… 0:04' })).toBeDefined();
  await clock.advance(1000);
  expect(await ui.find({ type: 'Markdown', text: 'Done thinking.' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /Reading the spec/ })).toBeUndefined();
  await ui.unmount();
});

test('a proposed change is a suggestion card, and Apply writes it through crew task edit', async ($, on) => {
  const seen = stubs(on, {
    complete: reply({
      reply: 'Reword the second step.',
      replacements: [{ old: '2. Second step', new: '2. Second step, clearer' }],
      apply: false,
    }),
  });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.post({ send: 'Is step two clear?' }, { in: 'composer' });
  expect(await ui.find({ type: 'Markdown', text: 'Reword the second step.' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: '+ 2. Second step, clearer' })).toBeDefined();
  expect(seen.calls).toEqual([]);
  await ui.press({ key: 'apply-3-0' });
  expect(seen.calls).toEqual([
    {
      args: ['task', '001', 'edit'],
      stdin: { old: '2. Second step', new: '2. Second step, clearer' },
    },
  ]);
  expect(await ui.find({ key: 'apply-3-0' })).toBeUndefined();
  await ui.unmount();
});

test('a change the person asked for is made without a click, showing Updating the spec', async ($, on) => {
  const seen = stubs(on, {
    slowEdit: true,
    complete: reply({
      reply: 'Reworded it.',
      replacements: [{ old: '2. Second step', new: '2. Second step, clearer' }],
      apply: true,
    }),
  });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  const reads = seen.reads.length;
  await ui.post({ send: 'Just fix step two.' }, { in: 'composer' });
  expect(await ui.find({ type: 'Text', text: 'Updating the spec… 0:00' })).toBeDefined();
  expect(seen.calls).toEqual([
    {
      args: ['task', '001', 'edit'],
      stdin: { old: '2. Second step', new: '2. Second step, clearer' },
    },
  ]);
  await seen.clock.advance(1000);
  expect(await ui.find({ type: 'Markdown', text: 'Reworded it.' })).toBeDefined();
  expect(await ui.find({ key: 'apply-3-0' })).toBeUndefined();
  expect(seen.reads.length).toBeGreaterThan(reads + 1);
  await ui.unmount();
});

test('a refused edit is reported in the reply', async ($, on) => {
  stubs(on, {
    refuse: 'task: no match',
    complete: reply({
      reply: 'Done.',
      replacements: [{ old: 'Gone line', new: 'x' }],
      apply: true,
    }),
  });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.post({ send: 'Fix it.' }, { in: 'composer' });
  expect(
    await ui.find({ type: 'Markdown', text: "Done.\n\n_Couldn't find 'Gone line' in the spec._" }),
  ).toBeDefined();
  await ui.unmount();
});

test('a reply that is not JSON is shown as it came', async ($, on) => {
  stubs(on, { complete: () => answer('Plain words, no JSON.') });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.post({ send: 'Hello?' }, { in: 'composer' });
  expect(await ui.find({ type: 'Markdown', text: 'Plain words, no JSON.' })).toBeDefined();
  await ui.unmount();
});

test('an unanswered completion shows why', async ($, on) => {
  stubs(on, {
    complete: () => ({
      isAnswered: false,
      reason: 'api-error',
      status: 401,
      error: 'authentication_failed',
      usage: USAGE,
    }),
  });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.post({ send: 'Hello?' }, { in: 'composer' });
  expect(
    await ui.find({
      type: 'Markdown',
      text: 'The model did not answer: api-error (authentication_failed)',
    }),
  ).toBeDefined();
  await ui.unmount();
});

test('? on a line sends the quote to the model', async ($, on) => {
  const seen = stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.press({ key: 'ask-0-0' });
  expect(seen.prompts[0].prompt).toContain(
    '> Holding OK opens a menu.\n\nCan we talk this one through?',
  );
  expect(await ui.find({ type: 'Markdown', text: 'Fine.' })).toBeDefined();
  await ui.unmount();
});

test('a throwing completion shows the error and leaves no status turn behind', async ($, on) => {
  stubs(on, {
    complete: () => {
      throw new Error('socket closed');
    },
  });
  const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
  await ui.post({ send: 'Hello?' }, { in: 'composer' });
  expect(
    await ui.find({ type: 'Markdown', text: /The model did not answer: threw/ }),
  ).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /Reading the spec/ })).toBeUndefined();
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

test('a done or building task offers neither', async ($, on) => {
  stubs(on, { status: 'done' });
  for (const key of ['card-001', 'card-002']) {
    const wall = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
    await wall.post({ select: key.slice(-3) }, { in: key });
    await wall.unmount();
    const ui = await $.ui.mount({ ...pane('crew-spec'), surface: 'desktop' });
    expect(await ui.find({ key: 'signoff' })).toBeUndefined();
    expect(await ui.find({ key: 'sendback' })).toBeUndefined();
    await ui.unmount();
  }
});
