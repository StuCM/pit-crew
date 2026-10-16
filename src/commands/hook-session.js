// SessionStart hook: in a repository that uses crew, tell the orchestrator
// session to route work through crew-spec before it touches code.
//
// The skill's description alone did not do it. The eval suite found Claude
// fixing a two-file bug directly in a crew repository with crew-spec in its
// skill list: no questions, no scout, no spec, no gate — the exact drift crew
// exists to stop. A line of context at the start of the session is what the
// description could not be: unconditional.
//
// A worker session is on a task branch and must implement, so it hears
// nothing from this.

import { git } from '../lib/git.js';
import { readClaim } from './orchestrator.js';

export const CONTEXT = [
  'This repository uses crew (.claude/crew.config.json).',
  'Before changing any code for a bug fix, feature or other change, load the crew:crew-spec skill and follow it, however small the change looks.',
  'It decides whether the work is done inline, specified for a worker, or planned first, and it asks what the person knows before anything is searched.',
  'A question about how the code works needs no skill: answer it.',
].join(' ');

const NONE =
  'No orchestrator is set for this repo. Mention this once when the person starts work that crew would spec. Suggest making this chat the orchestrator; do not claim it without being told.';

const roleText = (cfg, id) => {
  const claim = readClaim(cfg);
  if (!claim) return NONE;
  if (claim.session === id) {
    return `You are the orchestrator for ${cfg.project}, titled ${claim.title}. Side chats will send you proposals: fit each against the tasks in flight, say plainly if it conflicts, and give it a task number only when it becomes a spec.`;
  }
  return `${claim.title} is the orchestrator (claimed ${claim.claimed}). You are a side chat. Answer questions and make small inline edits (say you are doing so). Do not number tasks, write to ${cfg.tasksDir}, or run crew-run/crew-close. For anything bigger, send the orchestrator a proposal (what, why, the files you think it touches) with the session tools, tell the person it was sent, and carry on. If that chat is gone, the person can make this one the orchestrator.`;
};

export const run = (cfg, _args, id = null) => {
  // symbolic-ref, not rev-parse: it names the branch even before its first commit.
  const branch = git(['symbolic-ref', '--short', 'HEAD'], cfg.root)?.trim() ?? '';
  if (branch.startsWith(cfg.branchPrefix)) return 0;
  const idText = id ? ` Your session id is ${id}.` : '';
  const additionalContext = `${CONTEXT} ${roleText(cfg, id)}${idText}`;
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
    })}\n`,
  );
  return 0;
};
