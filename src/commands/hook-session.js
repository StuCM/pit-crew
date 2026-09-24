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

export const CONTEXT = [
  'This repository uses crew (.claude/crew.config.json).',
  'Before changing any code for a bug fix, feature or other change, load the crew:crew-spec skill and follow it, however small the change looks.',
  'It decides whether the work is done inline, specified for a worker, or planned first, and it asks what the person knows before anything is searched.',
  'A question about how the code works needs no skill: answer it.',
].join(' ');

export const run = (cfg) => {
  // symbolic-ref, not rev-parse: it names the branch even before its first commit.
  const branch = git(['symbolic-ref', '--short', 'HEAD'], cfg.root)?.trim() ?? '';
  if (branch.startsWith(cfg.branchPrefix)) return 0;
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: CONTEXT },
    })}\n`,
  );
  return 0;
};
