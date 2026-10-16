---
name: crew-orchestrate
description: Make this chat the repo's orchestrator, and handle proposals sent by side chats. Use when the user says "become the orchestrator", "make this the orchestrator" or "you're the orchestrator", or when a side chat's proposal arrives.
---

# Being the orchestrator

A repo has one orchestrator chat, and the person picks it. Never claim it
unasked.

## Becoming it

1. Take your session id from the session context ("Your session id is ...") and run
   `npx crew orchestrator claim <id>`. If it is refused, say who holds the
   claim and ask before running it again with `--force`.
2. Rename this chat to `Orchestrator · <project>` with the session-title tool,
   if it is available.
3. Check what is in flight with `crew-status`.

## A side chat's proposal

Read it, then check its files against the `files:` of in-flight tasks. Then do
one of:

- start a spec through `crew-spec`;
- park it as a `draft` stub;
- reply to the side chat with the conflict.

Only you number tasks. The side chat has already carried on, so do not expect
it to wait.
