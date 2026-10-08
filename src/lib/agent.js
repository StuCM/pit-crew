// Runs crew's agents headless through `claude -p`, for the pit wall and `crew chat`.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scoutArgs } from './wall.js';

const SCOUT = fileURLToPath(new URL('../../agents/crew-scout.md', import.meta.url));
export const CLAUDE = process.env.CREW_CLAUDE || 'claude';
export const AGENT_TIMEOUT = 15 * 60 * 1000;

/** Run one of crew's agents headless; resolves `{ text, session }` or `{ error }`. */
export const runAgent = (cwd, args, message, { bin = CLAUDE, env = {} } = {}) =>
  new Promise((done) => {
    const child = spawn(bin, args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), AGENT_TIMEOUT);
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', () => {
      clearTimeout(timer);
      done({ error: `${bin} is not on PATH, so crew's agents cannot run from here.` });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(out);
        if (result.is_error) return done({ error: result.result || 'the agent failed' });
        done({ text: result.result ?? '', session: result.session_id ?? null });
      } catch {
        done({ error: (err || out || 'the agent returned nothing').trim().slice(0, 600) });
      }
    });
    child.stdin.end(message);
  });

export const askScout = (cfg, message, session, bin = CLAUDE) =>
  runAgent(cfg.root, scoutArgs(SCOUT, session), message, { bin }).then((answer) =>
    answer.error ? answer : { ...answer, session: answer.session ?? session ?? null },
  );
