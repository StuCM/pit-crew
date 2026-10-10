import { expect, test } from 'claude-code/testing';

// A board with one draft, and a fake `crew` beneath the plugin that answers
// as the real one does: JSON on stdout, exit 1 on a refusal.
const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `task ${id}`,
  status,
  path: `/repo/.claude/tasks/${id}-x.md`,
  branch: `crew/${id}-x`,
  hasBranch: status !== 'draft',
  model: 'sonnet',
  files: ['src/a.ts'],
  rounds: 0,
  waitsOnUser: status === 'draft' ? 'spec needs your approval before anyone starts' : null,
  inFlight: status === 'building',
  terminal: false,
  worktree: status === 'building' ? `/p-${id}` : null,
  plannedWorktree: `/p-${id}`,
  ahead: status === 'building' ? 2 : 0,
  uncommitted: 0,
  brief: `Use the crew-worker skill for task .claude/tasks/${id}-x.md.`,
  ...extra,
});

const board = (tasks: unknown[]) => ({
  project: 'p',
  root: '/repo',
  main: '/repo',
  baseBranch: 'main',
  reviewRounds: 2,
  checkout: null,
  tasks,
});

const PANE = {
  component: 'Pane',
  requestId: 'pit-wall',
  props: { title: 'Pit wall', isFocused: false, bodyColumns: 80, placement: 'dock' } as any,
} as const;

const fakeCrew = (on: any, answer: (args: string[]) => { out: unknown; code?: number }) => {
  const calls: string[][] = [];
  on('session.root', () => ({ value: '/repo' }));
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    const args = e.argv.slice(1);
    calls.push(args);
    const { out, code = 0 } = answer(args);
    return { value: { exitCode: code, stdout: JSON.stringify(out), stderr: '' } };
  });
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-clipboard' } }));
  return calls;
};

test('a draft is approved and dispatched in one press, and the brief is shown', async ($, on) => {
  let status = 'draft';
  const calls = fakeCrew(on, (args) => {
    if (args[0] === 'tasks') return { out: board([task('007', status)]) };
    if (args[0] === 'approve') {
      status = 'approved';
      return { out: { ok: true, id: '007' } };
    }
    if (args[0] === 'dispatch') {
      status = 'building';
      return {
        out: {
          ok: true,
          id: '007',
          worktree: '/p-007',
          model: 'opus',
          brief: 'THE BRIEF',
          specCopied: false,
        },
      };
    }
    return { out: { ok: false, reason: 'unexpected' }, code: 2 };
  });

  const onSurface = async (surface: 'terminal' | 'desktop') => {
    status = 'draft';
    const ui = await $.ui.mount({ plugin: 'pit-wall', surface, ...PANE });
    await ui.press({ key: 'refresh' });
    expect(await ui.find({ text: /Waiting on you/ })).toBeDefined();

    await ui.press({ key: 'go:007' });
    expect(calls.some((c) => c[0] === 'approve' && c[1] === '007')).toBe(true);
    expect(calls.some((c) => c[0] === 'dispatch' && c[1] === '007' && !c.includes('--force'))).toBe(
      true,
    );
    expect(await ui.find({ text: /Task 007 is building/ })).toBeDefined();
    expect(await ui.find({ type: 'Code', text: 'THE BRIEF' })).toBeDefined();
    expect(await ui.find({ text: /Worktree: \/p-007/ })).toBeDefined();
    await ui.press({ key: 'dismiss' });
    await ui.unmount();
  };
  await onSurface('terminal');
  await onSurface('desktop');
});

test('a refused dispatch names the collision and offers to run anyway', async ($, on) => {
  const calls = fakeCrew(on, (args) => {
    if (args[0] === 'tasks') return { out: board([task('008', 'approved')]) };
    if (args[0] === 'dispatch' && !args.includes('--force')) {
      return {
        code: 1,
        out: {
          ok: false,
          reason: 'other work already touches these files',
          overlaps: [{ id: '009', title: 'busy', files: ['src/a.ts'] }],
          collisions: [],
        },
      };
    }
    if (args[0] === 'dispatch')
      return { out: { ok: true, worktree: '/p-008', model: 'sonnet', brief: 'B' } };
    return { out: {} };
  });

  const ui = await $.ui.mount({ plugin: 'pit-wall', surface: 'desktop', ...PANE });
  await ui.press({ key: 'refresh' });
  await ui.press({ key: 'run:008' });
  expect(await ui.find({ text: /Task 009 \(busy\) is in flight on src\/a.ts/ })).toBeDefined();

  await ui.press({ key: 'force' });
  expect(calls.some((c) => c[0] === 'dispatch' && c.includes('--force'))).toBe(true);
  expect(await ui.find({ text: /Task 008 is building/ })).toBeDefined();
});

test('a task with commits can be put on the bench', async ($, on) => {
  const calls = fakeCrew(on, (args) => {
    if (args[0] === 'tasks') return { out: board([task('010', 'building')]) };
    if (args[0] === 'checkout')
      return { out: { ok: true, bench: '/p-bench', tip: 'abcdef123', uncommittedInWorktree: 1 } };
    return { out: {} };
  });

  const ui = await $.ui.mount({ plugin: 'pit-wall', surface: 'terminal', ...PANE });
  await ui.press({ key: 'refresh' });
  await ui.press({ key: 'checkout:010' });
  expect(calls.some((c) => c[0] === 'checkout' && c[1] === '010')).toBe(true);
  expect(await ui.find({ text: /\/p-bench is at abcdef1/ })).toBeDefined();
  expect(await ui.find({ text: /1 uncommitted change/ })).toBeDefined();
});
