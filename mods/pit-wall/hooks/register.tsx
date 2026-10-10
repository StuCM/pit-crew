// The pit wall as a pane in the orchestrator's session.
//
// Everything it does is a `crew` command: the pane draws `crew tasks --json`
// and its buttons call `crew approve`, `crew dispatch` and `crew checkout`.
// So a collision refuses a dispatch here exactly as it does in the skill, and
// nothing about the loop lives only in this file.

import { atom, read, update } from 'claude-code';
import type { EngineInterface, Register, RenderSurface } from 'claude-code';

import type { PitNotice, PitSnapshot, PitSpec, PitTask } from '../types';

const PANE = 'pit-wall';
const snapshot = atom({ plugin: 'pit-wall', key: 'snapshot' } as const, null as PitSnapshot | null);
const error = atom({ plugin: 'pit-wall', key: 'error' } as const, null as string | null);
const notice = atom({ plugin: 'pit-wall', key: 'notice' } as const, null as PitNotice | null);
const busy = atom({ plugin: 'pit-wall', key: 'busy' } as const, null as string | null);
const spec = atom({ plugin: 'pit-wall', key: 'spec' } as const, null as PitSpec | null);
const isOpen = atom({ plugin: 'pit-wall', key: 'isOpen' } as const, false);

// The markdown element draws at most 10000 characters.
const SPEC_LIMIT = 9500;

type Answer = { ok?: boolean; reason?: string; [key: string]: unknown };

// Which way of reaching crew worked: a global install, else the project's.
// A module variable on purpose: a reload asks again.
let crewArgv: string[] | null = null;

async function crew(
  $: EngineInterface,
  args: string[],
): Promise<{ code: number; out: string; err: string }> {
  const cwd = await $.session.root();
  const tries = crewArgv ? [crewArgv] : [['crew'], ['npx', '--no-install', 'crew']];
  let lastError = '';
  for (const argv of tries) {
    try {
      // In order on purpose: the second is tried only when the first fails.
      // oxlint-disable-next-line no-await-in-loop
      const ran = await $.process.run([...argv, ...args], { cwd, timeoutMs: 60_000 });
      // npx with nothing installed says so on stderr and exits non-zero.
      if (argv[0] === 'npx' && ran.exitCode !== 0 && !ran.stdout.trim()) {
        lastError = ran.stderr.trim();
        continue;
      }
      crewArgv = argv;
      return { code: ran.exitCode, out: ran.stdout, err: ran.stderr };
    } catch (cause) {
      lastError = String(cause);
    }
  }
  return {
    code: 127,
    out: '',
    err: lastError || 'crew is not installed: npm install --global @stucm/pit-crew',
  };
}

async function crewJson($: EngineInterface, args: string[]): Promise<Answer> {
  const ran = await crew($, [...args, '--json']);
  try {
    return JSON.parse(ran.out) as Answer;
  } catch {
    return { ok: false, reason: (ran.err || ran.out).trim() || `crew exited ${ran.code}` };
  }
}

async function refresh($: EngineInterface) {
  const ran = await crew($, ['tasks', '--json']);
  if (ran.code !== 0) {
    await update($, error, () => (ran.err || ran.out).trim() || `crew exited ${ran.code}`);
    return;
  }
  try {
    const data = JSON.parse(ran.out) as PitSnapshot;
    await update($, snapshot, () => data);
    await update($, error, () => null);
  } catch {
    await update($, error, () => 'crew tasks --json did not answer JSON');
  }
}

function say($: EngineInterface, next: PitNotice | null) {
  return update($, notice, () => next);
}

// One press at a time per task, and the board read again after each.
const act = async ($: any, key: string, work: () => Promise<unknown>) => {
  if (await read($, busy)) return;
  await update($, busy, () => key);
  try {
    await work();
  } catch (cause) {
    await say($, { tone: 'error', title: 'That did not work', lines: [String(cause)] });
  } finally {
    await update($, busy, () => null);
    await refresh($);
  }
};

async function dispatchTask(
  $: EngineInterface,
  id: string,
  force: boolean,
  surface?: RenderSurface,
) {
  const result = await crewJson($, ['dispatch', id, ...(force ? ['--force'] : [])]);
  if (!result.ok) {
    const overlaps = (result.overlaps as { id: string; title: string; files: string[] }[]) ?? [];
    const collisions =
      (result.collisions as { branch: string; commit: string; path: string }[]) ?? [];
    const lines = [
      ...overlaps.map((o) => `Task ${o.id} (${o.title}) is in flight on ${o.files.join(', ')}`),
      ...collisions.map((c) => `${c.branch} ${c.commit} touches ${c.path}`),
    ];
    const pushable = overlaps.length + collisions.length > 0;
    await say($, {
      tone: 'warn',
      title: `Task ${id} not started: ${result.reason}`,
      lines: pushable ? [...lines, 'Land or respec around them, or run it anyway.'] : lines,
      forceId: pushable ? id : undefined,
    });
    return;
  }

  const brief = String(result.brief);
  // A desktop surface has no clipboard path yet, so the brief is also drawn
  // for copying; say which happened rather than leave the person guessing.
  const copied = await $.ui.copy({ text: brief, surface }).then(
    (r: { isCopied: boolean }) => r.isCopied,
    () => false,
  );
  await say($, {
    tone: 'ok',
    title: `Task ${id} is building`,
    lines: [
      `Worktree: ${result.worktree}`,
      `Model: ${result.model}`,
      copied
        ? 'Brief copied. Start a new session in that folder and paste it.'
        : 'Start a new session in that folder, on that model, with this brief:',
      ...(result.specCopied
        ? ['The spec was not committed, so it was copied into the worktree.']
        : []),
    ],
    code: brief,
  });
}

async function openInEditor($: EngineInterface, path: string) {
  const editor = (await $.env.get('CREW_EDITOR')) || 'code';
  try {
    const ran = await $.process.run([editor, path], { timeoutMs: 15_000 });
    if (ran.exitCode !== 0) $.ui.toast(`${editor} exited ${ran.exitCode}: ${ran.stderr.trim()}`);
  } catch (cause) {
    $.ui.toast(`Could not start ${editor}: set CREW_EDITOR. ${String(cause)}`);
  }
}

async function openPane($: EngineInterface) {
  await update($, isOpen, () => true);
  await $.ui.open({ id: PANE, title: 'Pit wall' });
  await refresh($);
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e);
    await $.command.register({
      name: 'pitwall',
      description: 'Open the crew board: approve, run and test tasks',
    });

    // Open unasked only in a crew repository's main checkout: that is the
    // orchestrator. A task session in its worktree has no use for the board.
    await refresh($);
    const data = await read($, snapshot);
    const root = await $.session.root();
    if (data && data.main === root) await openPane($);

    $.clock.every(5000, () => {
      void (async () => {
        if ((await read($, isOpen)) && !(await read($, busy))) await refresh($);
      })();
    });
    return started;
  });

  on('command.run', { command: 'pitwall' }, async ($) => {
    await openPane($);
    return { text: 'Pit wall opened.' };
  });

  // Never keep a pane open over a failed write.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, isOpen, () => false);
    return next(e);
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown, Code } = $.ui.resolve(e);
    const data = await read($, snapshot);
    const failed = await read($, error);
    const shown = await read($, notice);
    const working = await read($, busy);
    const open = await read($, spec);

    const header = (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text bold>{data ? `Pit wall · ${data.project}` : 'Pit wall'}</Text>
        {working ? <Text dimColor>working…</Text> : null}
        <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
      </Box>
    );

    if (!data) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Text>{failed ?? 'Reading the board…'}</Text>
        </Box>
      );
    }

    const bench = data.checkout ? (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text>
          Bench: task {data.checkout.task} at {data.checkout.tip.slice(0, 7)}
        </Text>
        <Button
          key="bench:open"
          label="Open bench"
          onPress={() => openInEditor($, data.checkout!.bench)}
        />
        <Button
          key="bench:back"
          label="Back"
          onPress={() =>
            act($, 'back', async () => {
              const result = await crewJson($, ['checkout', '--back']);
              await say(
                $,
                result.ok
                  ? { tone: 'ok', title: 'The bench is back where it was', lines: [] }
                  : { tone: 'error', title: 'Could not go back', lines: [String(result.reason)] },
              );
            })
          }
        />
      </Box>
    ) : null;

    const banner = shown ? (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={shown.tone === 'ok' ? 'green' : shown.tone === 'warn' ? 'yellow' : 'red'}
        paddingX={1}
      >
        <Text bold>{shown.title}</Text>
        {shown.lines.map((line) => (
          <Text>{line}</Text>
        ))}
        {shown.code ? <Code source={shown.code} language="text" /> : null}
        <Box flexDirection="row" gap={1}>
          {shown.forceId ? (
            <Button
              key="force"
              label="Run anyway"
              onPress={(press) =>
                act($, `run:${shown.forceId}`, () =>
                  dispatchTask($, shown.forceId!, true, press.surface),
                )
              }
            />
          ) : null}
          <Button key="dismiss" label="Dismiss" role="dismiss" onPress={() => say($, null)} />
        </Box>
      </Box>
    ) : null;

    const buttons = (task: PitTask) => {
      const id = task.id;
      const list = [];
      const specButton = (
        <Button
          key={`spec:${id}`}
          label={open?.id === id ? 'Hide spec' : 'Spec'}
          dimColor
          onPress={async () => {
            if ((await read($, spec))?.id === id) return update($, spec, () => null);
            const text = await $.fs
              .read(task.path)
              .catch((cause: unknown) => `Could not read ${task.path}: ${cause}`);
            return update($, spec, () => ({ id, text }));
          }}
        />
      );

      if (task.status === 'draft') {
        list.push(
          <Button
            key={`go:${id}`}
            label="Approve & run"
            variant="primary"
            onPress={(press) =>
              act($, `go:${id}`, async () => {
                const approved = await crewJson($, ['approve', id]);
                if (!approved.ok) {
                  return say($, {
                    tone: 'error',
                    title: `Task ${id} not approved`,
                    lines: [String(approved.reason)],
                  });
                }
                return dispatchTask($, id, false, press.surface);
              })
            }
          />,
          <Button
            key={`approve:${id}`}
            label="Approve only"
            onPress={() =>
              act($, `approve:${id}`, async () => {
                const approved = await crewJson($, ['approve', id]);
                await say(
                  $,
                  approved.ok
                    ? {
                        tone: 'ok',
                        title: `Task ${id} approved`,
                        lines: ['Run it when you are ready.'],
                      }
                    : {
                        tone: 'error',
                        title: `Task ${id} not approved`,
                        lines: [String(approved.reason)],
                      },
                );
              })
            }
          />,
        );
      } else if (task.status === 'approved') {
        list.push(
          <Button
            key={`run:${id}`}
            label="Run"
            variant="primary"
            onPress={(press) =>
              act($, `run:${id}`, () => dispatchTask($, id, false, press.surface))
            }
          />,
        );
      } else {
        if (task.inFlight) {
          list.push(
            <Button
              key={`brief:${id}`}
              label="Brief"
              onPress={() =>
                say($, {
                  tone: 'ok',
                  title: `Task ${id}'s session`,
                  lines: [
                    `Worktree: ${task.worktree ?? task.plannedWorktree}`,
                    `Model: ${task.model}`,
                  ],
                  code: task.brief,
                })
              }
            />,
          );
        }
        if (task.hasBranch && task.ahead > 0) {
          list.push(
            <Button
              key={`checkout:${id}`}
              label={data.checkout?.task === id ? 'Check out again' : 'Check out'}
              onPress={() =>
                act($, `checkout:${id}`, async () => {
                  const result = await crewJson($, ['checkout', id]);
                  if (!result.ok) {
                    return say($, {
                      tone: 'error',
                      title: `Could not check out task ${id}`,
                      lines: [String(result.reason), ...((result.changed as string[]) ?? [])],
                    });
                  }
                  const pending = Number(result.uncommittedInWorktree ?? 0);
                  return say($, {
                    tone: 'ok',
                    title: `Task ${id} is on the bench`,
                    lines: [
                      `${result.bench} is at ${String(result.tip).slice(0, 7)}. Run it from there.`,
                      ...(pending
                        ? [`The worker has ${pending} uncommitted change(s), not included.`]
                        : []),
                    ],
                  });
                })
              }
            />,
          );
        }
        if (task.worktree) {
          list.push(
            <Button
              key={`tree:${id}`}
              label="Worktree"
              onPress={() => openInEditor($, task.worktree!)}
            />,
          );
        }
      }
      list.push(specButton);
      return list;
    };

    const row = (task: PitTask) => {
      const facts = [
        task.status,
        task.waitsOnUser,
        task.ahead ? `${task.ahead} commit${task.ahead === 1 ? '' : 's'}` : null,
        task.uncommitted ? `${task.uncommitted} uncommitted` : null,
        task.rounds ? `round ${task.rounds}/${data.reviewRounds}` : null,
        task.model,
      ].filter(Boolean);
      return (
        <Box key={`task:${task.id}`} flexDirection="column">
          <Text bold>
            {task.id} {task.title}
          </Text>
          <Text dimColor>{facts.join(' · ')}</Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {buttons(task)}
          </Box>
          {open?.id === task.id ? (
            <Box borderStyle="single" paddingX={1}>
              <Markdown
                text={
                  open.text.length > SPEC_LIMIT
                    ? `${open.text.slice(0, SPEC_LIMIT)}\n\n…cut here; the whole spec is ${task.path}`
                    : open.text
                }
              />
            </Box>
          ) : null}
        </Box>
      );
    };

    const groups: [string, PitTask[]][] = [
      ['Waiting on you', data.tasks.filter((t) => t.waitsOnUser)],
      ['Ready to run', data.tasks.filter((t) => t.status === 'approved')],
      ['In flight', data.tasks.filter((t) => t.inFlight)],
      ['Done', data.tasks.filter((t) => t.terminal)],
    ];

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {failed ? <Text color="red">{failed}</Text> : null}
        {bench}
        {banner}
        {data.tasks.length === 0 ? (
          <Text dimColor>No tasks yet. Write one with /crew:crew-spec.</Text>
        ) : null}
        {groups
          .filter(([, tasks]) => tasks.length)
          .map(([title, tasks]) => (
            <Box key={`group:${title}`} flexDirection="column" gap={1}>
              <Text bold underline>
                {title}
              </Text>
              {tasks.map(row)}
            </Box>
          ))}
      </Box>
    );
  });
};
