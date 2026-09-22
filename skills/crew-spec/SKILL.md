---
name: crew-spec
description: Write and get approval for a task spec before any work starts. Use when the user wants to start a new piece of work, or says "spec this", "let's plan X", or names a backlog item to pick up.
---

# Writing a task spec

You are the orchestrator. You hold the conversation, the project, and the
reasons. This skill produces the one artifact everything else runs on.

The spec is where the token budget is won or lost. A worker given file names
and call sites starts writing immediately; a worker given a paragraph spends
tens of thousands of tokens rediscovering what you already knew.
**Specificity here is the optimisation, not the ceremony.**

## 0. What does this work already know about itself?

```sh
npx crew plan
```

Four states. Only the first two go straight to writing a spec.

**A draft already exists.** `agent-tasks` writes `status: draft` specs in the
shape below, with `files:`, Approach and Out of scope already lifted from the
maps. Do not rewrite one from scratch — pick it up at step 2 and do the three
things it deliberately did not: collisions, the graph, and approval.

**A plan with a part covering this work.** Read it — `npx crew plan <part-id>`
— and put its id in the task's `part:`, so the worker and the reviewer read
the same thing. If that part still carries open questions, or its symbols are
unverified, it is not ready: treat it as the fourth state.

**No plan at all**, or **a plan with nothing covering this work.** Decide
whether this work earns a map, and route on blast radius rather than on the
word "bug" or "feature":

- One file, cause known, nothing surprising → **no map**. Go to step 1. Running
  the planning chain for a one-line fix is overhead, and a map nobody needed is
  a map nobody maintains.
- It crosses a boundary, it touches code you have not read, or nobody can yet
  say where it goes → **build the map before the spec.** This is the cheapest
  moment there will ever be to be wrong.

### Building one yourself

**Say what you are doing and why, in one line, before you start.** A map is
minutes, not seconds. A spec the user expected in one message must not
silently become a planning session.

These take inputs and write files, so you may run them without being asked:

- **feature-map** — the usual case: an existing codebase gaining or changing
  something. Run it against the actual repository, and persist what it proved:

  ```sh
  python3 ${CLAUDE_PLUGIN_ROOT}/planning/skills/feature-map/scripts/build_feature.py \
      <map>.json --repo . --write-back -o <out>.html
  ```

  **Never build one from recollection.** A framework you know well is exactly
  where a confidently wrong signature is most likely and hardest to spot, and
  without `--write-back` the verification lives only in the HTML, so every
  downstream task blocks as unverified.

- **architecture-map** — several new parts and the boundaries between them,
  when the question is what the pieces are rather than where they go in an
  existing tree.

- **agent-tasks** — once a map holds, it emits the draft specs. Then you are in
  the first state, and pick up at step 2.

### What you must not do yourself

These are conversations with the user, and running them alone wastes them:

- **brainstorm-map** — when nobody can yet say what the thing *is*. Say so and
  offer it. Do not map a conversation that has not happened.
- **open-threads** — when a map comes back carrying open questions.
  `agent-tasks` refuses to emit a task for a part with one, and that refusal is
  the entire point of the pipeline. Put the questions to the user. Do not answer
  them yourself, and do not reach for `--force`.

**The maps are not a second memory.** They are the working surface for this
piece of work; the graph is the durable record. Read them here, inline what
matters, and do not teach the worker to query both.

## 1. Prime from the graph — you, once, not every agent

```sh
npx crew graph prime
npx crew graph prefs
npx crew graph traps
npx crew graph find <the subsystem this touches>
```

Read what comes back and keep only what bears on *this* task. Then **inline it
into the spec's Graph context section**, in your own words, compressed.

This is deliberate: one query per task instead of one per agent, filtered by
someone with judgement, and workers stay hermetic — they need no MCP, no
network, and no memory of previous sessions. If the CLI is absent it says so
and you fall back to the project's own decision record; the loop does not
stall.

Pay attention to anything that reads as a trap or a phantom problem. Carrying
one line — *"a 403 from the proxy is environmental, not the app"* — into the
spec is what stops the next agent spending an hour on it.

## 2. Establish what the task actually is

Talk it through with the user. Push on:

- **What is different afterwards, from the outside?** If you cannot say it in
  a sentence, the task is too big — split it.
- **Which files?** Go and look. Grep for the call sites. The `files:` list is a
  contract — the scope hook refuses a write outside it — so a wrong one blocks
  the worker on something you could have checked in a minute.
- **Where can it be proven?** Set `env:`. `npx crew doctor` lists the
  environments and their statuses. If the answer is an environment no agent can
  reach, say so now and set expectations: code-complete is the best the loop
  can reach.
- **What is explicitly out of scope?** Ask directly. An empty Out of scope
  section means the reviewer invents its own.
- **Which model?** The project's `models.default` for well-specified work;
  `models.critical` only for the code the project brief says must not be wrong.
- **Which part of the plan?** If there is one, set `part:`. An open question
  on that part is a spec bug: `agent-tasks` would have refused to emit this
  task, and `npx crew plan` prints the questions. Settle them with
  `open-threads` before approval, not in code afterwards.

Once `files:` is settled, ask whether the work already exists:

```sh
npx crew collisions .claude/tasks/<NNN>-<slug>.md
```

The board only knows about *tasks*. A commit sitting on a branch nobody turned
into a task is invisible to it, and specifying over the top of one wastes a
whole session on work that is already written. This asks git instead.

Whatever it prints, put in the task file under **Existing work** — verbatim,
plus one line on what you make of each hit after reading it
(`git log -p HEAD..<branch> -- <file>`). The person approving the spec has to
see it; finding it at dispatch is a round too late. If it prints nothing, say
`None.` so the reader knows the question was asked.

## 3. Write it

```sh
npx crew spec-template > .claude/tasks/<NNN>-<slug>.md
```

Next free number, three digits. Fill every section. The Definition of done is
the one that matters most: the reviewer executes it literally, so nothing in it
may be a matter of taste. Each item must be checkable by someone who was not in
this conversation.

Keep **Constraints that bite here** to the rules that actually touch these
files. The worker already reads `.claude/crew/project.md`; repeating it here
costs tokens in every downstream agent and says nothing new.

## 4. Get approval — this is a hard gate

Show the user the spec. Ask plainly whether to proceed.

**Do not spawn a worker until they say yes.** They asked for this gate for a
reason: a wrong spec is the most expensive thing in the system, and it is
cheapest to fix right now.

On approval set `status: approved`, run `npx crew log <task> spec`, and tell
them `/crew-run <id>` is next.
