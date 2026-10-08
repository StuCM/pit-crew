import { expect, test } from 'claude-code/testing';

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
  ],
};

// A fake crew: `board --json` answers from a board that `task` calls change, as the real files would.
const stubs = (on: any, { boardRun, refuse }: { boardRun?: any; refuse?: string } = {}) => {
  const board = structuredClone(BOARD);
  const seen = {
    calls: [] as any[],
    reads: [] as string[],
    submitted: [] as string[],
    toasts: [] as string[],
  };
  on('process.run', ($: any, e: any) => {
    const args = e.argv.slice(3);
    if (args[0] === 'board')
      return { value: boardRun ?? { exitCode: 0, stdout: JSON.stringify(board), stderr: '' } };
    seen.calls.push({ args, stdin: e.init?.stdin && JSON.parse(e.init.stdin) });
    if (refuse) return { value: { exitCode: 1, stdout: '', stderr: refuse + '\nmore' } };
    const task = board.tasks.find((t) => t.id === args[1])!;
    if (args[2] === 'approve') task.status = 'approved';
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
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('ui.scroll', () => ({}));
  return seen;
};

test('tabs: spec first, context and build record on their own tabs', async ($, on) => {
  stubs(on);
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('crew-wall'), surface });
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

test('the spec flows under the board at full length, and closing it gives the board the pane', async ($, on) => {
  stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  expect(await ui.find({ type: 'Markdown', text: /Second step/ })).toBeDefined();
  await ui.press({ key: 'close-spec' });
  expect(await ui.find({ key: 'spec-window' })).toBeUndefined();
  expect(await ui.find({ key: 'board-window' })).toBeDefined();
  await ui.unmount();
});

test('the spec is the selected task file, read from the board root', async ($, on) => {
  const seen = stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  expect(await ui.find({ type: 'Markdown', text: /Holding OK opens a menu/ })).toBeDefined();
  expect(seen.reads).toContain('/repo/.claude/tasks/001-first.md');
  await ui.unmount();
});

test('edit, remove, add and remove-section write the task file through crew task edit', async ($, on) => {
  const seen = stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
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
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
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
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
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
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  await ui.press({ key: 'rm-2-1' });
  expect(seen.toasts).toEqual(['task: that text is no longer in the spec']);
  expect(await ui.find({ type: 'Markdown', text: '2. Second step' })).toBeDefined();
  await ui.press({ key: 'approve' });
  expect(seen.submitted).toEqual([]);
  expect(await ui.find({ key: 'approve' })).toBeDefined();
  await ui.unmount();
});

test('the board has a column per status and a flag on tasks waiting on the person', async ($, on) => {
  stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  expect(await ui.find({ key: 'composer' })).toBeDefined();
  const draft = (await ui.find({ key: 'card-001' }))?.props.props;
  expect(draft.title).toBe('First thing');
  expect(draft.who).toBe('opus');
  expect(draft.attention).toBe('spec needs your approval');
  expect((await ui.find({ key: 'card-002' }))?.props.props.attention).toBe('');
  for (const name of ['draft', 'approved', 'building', 'done']) {
    expect(await ui.find({ type: 'Text', text: name })).toBeDefined();
  }
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
  stubs(on);
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: 'Here: {"nodes":[{"id":"a","label":"OK pressed","kind":"start"},{"id":"b","label":"Held 500ms?","kind":"decision"},{"id":"c","label":"Open menu","kind":"end"}],"edges":[{"from":"a","to":"b"},{"from":"b","to":"c","label":"yes"}]}',
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  }));
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
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
