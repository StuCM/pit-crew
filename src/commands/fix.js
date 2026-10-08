// `crew fix <id>` — hand a task's open suggestions to the fixer and print what it did.

import { join } from 'node:path';
import { applySuggestions } from '../lib/agent.js';
import { readTasks } from '../lib/task.js';

export const run = async (cfg, [id] = []) => {
  const task = readTasks(join(cfg.root, cfg.tasksDir)).find((t) => t.id === String(id));
  if (!task) {
    console.error(id ? `fix: no task ${id}` : 'usage: crew fix <id>');
    return 1;
  }
  const result = await applySuggestions(cfg, task);
  if (result.error) {
    console.error(`fix: ${result.error}`);
    return 1;
  }
  console.log(JSON.stringify(result.suggestions));
  return result.suggestions.every((s) => s.status === 'applied') ? 0 : 1;
};
