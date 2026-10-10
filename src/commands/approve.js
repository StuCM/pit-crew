// The first human gate, as a command, so a button can press it. It logs the
// same event as approving in the conversation or on the pit wall.

import { findTask } from '../lib/handover.js';
import { setField } from '../lib/task.js';
import { writeBoard } from './board.js';
import { appendLog } from './log.js';

export const approve = (cfg, task) => {
  if (task.meta.status !== 'draft') {
    return { ok: false, reason: `task ${task.id} is ${task.meta.status}, not draft` };
  }
  setField(task.path, 'status', 'approved');
  appendLog(cfg, task.path, 'spec');
  writeBoard(cfg);
  return { ok: true, id: task.id };
};

export const run = (cfg, args) => {
  const json = args.includes('--json');
  const arg = args.find((a) => !a.startsWith('--'));
  const task = findTask(cfg, arg);
  const result = task ? approve(cfg, task) : { ok: false, reason: `no task "${arg ?? ''}"` };

  if (json) console.log(JSON.stringify(result));
  else if (result.ok) console.log(`approve: ${result.id} is approved`);
  else console.error(`approve: ${result.reason}`);
  return result.ok ? 0 : task ? 1 : 2;
};
