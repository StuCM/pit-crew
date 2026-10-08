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

const stubs = (on: any) => {
  on('fs.read', () => ({ value: SPEC }));
  on('fs.exists', ($: any, e: any) => ({ value: e.path.endsWith('src/a.ts') }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('clock.after', () => ({ value: { cancel() {} } }));
  on('ui.scroll', () => ({}));
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

test('edit, remove, restore, add and ask on agreement blocks', async ($, on) => {
  stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  await ui.press({ key: 'edit-btn-2-1' });
  await ui.input({ key: 'edit-2-1', text: 'Second step, reworded' });
  expect(await ui.find({ type: 'Markdown', text: '2. Second step, reworded' })).toBeDefined();
  await ui.press({ key: 'rm-3-0' });
  expect(await ui.find({ key: 'restore-3-0' })).toBeDefined();
  await ui.press({ key: 'restore-3-0' });
  await ui.press({ key: 'add-3' });
  await ui.input({ key: 'new-3', text: 'Scheduled exports' });
  expect(await ui.find({ type: 'Markdown', text: '- Scheduled exports' })).toBeDefined();
  await ui.press({ key: 'ask-0-0' });
  expect(await ui.find({ type: 'Markdown', text: /Can we talk this one through/ })).toBeDefined();
  expect(await ui.find({ key: 'approve' })).toBeDefined();
  await ui.unmount();
});

test('approve starts automatically, with a manual start as the fallback', async ($, on) => {
  stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  await ui.press({ key: 'approve' });
  expect(await ui.find({ type: 'Text', text: 'Starting…' })).toBeDefined();
  await ui.press({ key: 'start' });
  expect(await ui.find({ type: 'Text', text: '● Running' })).toBeDefined();
  expect((await ui.find({ key: 'column' }))?.props.value).toBe('Running');
  await ui.unmount();
});

test('the composer is drawn, and cards press as a whole', async ($, on) => {
  stubs(on);
  const ui = await $.ui.mount({ ...pane('crew-wall'), surface: 'desktop' });
  expect(await ui.find({ key: 'composer' })).toBeDefined();
  const card = (await ui.find({ key: 'card-PC-09' }))?.props.props;
  expect(card.id).toBe('PC-09');
  expect(card.attention).toBe('Review rounds disagreed');
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
