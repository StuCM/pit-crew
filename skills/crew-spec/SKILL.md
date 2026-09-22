---
name: crew-spec
description: Work out what kind of work this is, then route it — straight to a spec, or an offer to plan first. Use when the user starts a piece of work: a bug to fix, a feature to add, something to change, "spec this", "let's plan X", or a backlog item to pick up. Not for questions about how existing code already works.
---

# Routing a piece of work, then specifying it

You are the orchestrator. You hold the conversation, the project, and the
reasons. This skill produces the one artifact everything else runs on.

Two standing rules, and they pull in opposite directions on purpose.

**You do not implement.** Building means handing the task to its own session
in its own worktree — `/crew:crew-run`. This is the rule that gets broken
quietly: you have the context, the change looks small, and writing it is
faster than specifying it. Then nothing was gated, nothing was reviewed, and
there is no task to show for the work. The one exception is a change too small
to deserve a worktree — a typo, a version bump, a one-line revert. Take it
inline if you like, but **say out loud that you are stepping outside the
loop**, so it is a decision rather than a drift.

**You do not start planning unasked.** Everything in step 0 that is not a spec
is an *offer*: one line, then wait. A user who wanted a spec in one message
must not find themselves in a planning session they did not ask for. If they
do not engage with the offer, they declined it — write the spec.

The spec is where the token budget is won or lost. A worker given file names
and call sites starts writing immediately; a worker given a paragraph spends
tens of thousands of tokens rediscovering what you already knew.
**Specificity here is the optimisation, not the ceremony.**

## 0. What kind of work is this?

Settle this first, in your head, before reaching for anything. Most of these
shapes do not want a spec at all, and the cost of guessing wrong is either a
planning session nobody asked for or a change nobody gated.

| It sounds like | It is | What you do |
|---|---|---|
| "how does X work?", "where is Y?", "why does it do Z?" | **exploration** | Answer it. No spec, no map, no worktree. If it turns into work, you will be back here. |
| "fix this typo", "bump the version", a one-line revert | **too small for the loop** | Say you are doing it inline, and do it. |
| a bug with a known cause in a file you can name | **a task** | Straight to step 1. Offer nothing. |
| a bug nobody can scope, or one that keeps coming back | **a planning problem wearing a bug's clothes** | Offer a map. |
| a feature inside an existing system | **a task, or a small plan** | Judge by how much of the surrounding code is unread. |
| a new subsystem, or several parts and the boundaries between them | **a plan** | Offer a map. |
| "I have an idea and I am not sure what it is yet" | **a conversation** | Offer to brainstorm. Nothing else. |

If you cannot tell, ask — one question, not an interview. "Is this a known
cause in a file you can point at, or is scoping it part of the job?" separates
most of these in one round trip.

### Then look at what already exists

```sh
npx crew plan
```

- **A draft already covers this.** `agent-tasks` writes `status: draft` specs
  in the shape below, with `files:`, Approach and Out of scope lifted from the
  maps. Do not rewrite one — pick it up at step 2 and do the three things it
  deliberately did not: collisions, the graph, and approval.
- **A plan with a part covering this.** Read it — `npx crew plan <part-id>` —
  and put its id in the task's `part:` so the worker and the reviewer read the
  same thing. If it still carries open questions or unverified symbols, say so
  and offer `open-threads` or a rebuild; do not spec over the top of it.
- **Nothing covering this.** Go to the spec, unless the table above said to
  offer a map.

### Offering, not starting

One line. Name the thing, say what it would cost, and wait.

> This crosses the search indexer and the tile save path, and I have not read
> either. Worth a feature map first — ten minutes, and it verifies the symbols
> against the real files. Or I can spec it now from what you tell me. Which?

**If they say no, or say nothing about it, write the spec.** Declining is a
complete answer and does not need justifying. Do not re-offer later in the
same piece of work.

**If they say yes**, these three take inputs and write files, so you run them
once the user has agreed to the *plan*, not once per skill — do not ask again
between each:

- **feature-map** — the usual case: existing code gaining or changing
  something. Against the real repository, and persist what it proved:

  ```sh
  python3 ${CLAUDE_PLUGIN_ROOT}/planning/skills/feature-map/scripts/build_feature.py \
      <map>.json --repo . --write-back -o <out>.html
  ```

  **Never from recollection.** A framework you know well is where a
  confidently wrong signature is most likely and hardest to spot. Without
  `--write-back` the verification lives only in the HTML, so every downstream
  task blocks as unverified.

- **architecture-map** — when the question is what the pieces are, rather than
  where they go in a tree that already exists.

- **agent-tasks** — once a map holds, it emits the draft specs, and you are
  back at the first case above.

These two are conversations with the user, so you **offer and stop**, even
mid-plan:

- **brainstorm-map** — when nobody can yet say what the thing *is*. Mapping a
  conversation that never happened is worth nothing.
- **open-threads** — when a map comes back carrying open questions.
  `agent-tasks` refuses to emit a task for a part with one, and that refusal
  is the point of the whole pipeline. Put the questions to the user; do not
  answer them yourself and do not reach for `--force`.

**The maps are not a second memory.** They are the working surface for this
piece of work; the graph is the durable record. Read them here, inline what
matters, and do not teach the worker to query both.

## 1. Prime from the graph — you, once, not every agent

```sh
npx crew graph prime       # what this project is
npx crew graph prefs       # how this person wants work done
npx crew graph traps       # this project's Patterns, newest first
npx crew graph decisions   # and its Decisions
npx crew graph find <the subsystem this touches>
```

Each is bounded and scoped to this project — `--limit=N` if you want more.
`prefs` is deliberately *not* scoped: how someone wants work done travels
between their projects.

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
- **Which part of the plan?** If there is one, set `part:` — it is how the
  worker and the reviewer reach the same diagram.

Once `files:` is settled, ask the graph about those exact files:

```sh
npx crew graph files <each path in files:>
```

`crew graph traps` is the project's traps in general; this is what is recorded
against *these* paths, which is the sharper question and the one worth the
tokens. Anything it returns goes into **Graph context**, compressed, in your
own words. A trap recorded against a file the task is about to edit is the
single highest-value line a spec can carry.

Then ask whether the work already exists:

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
them `/crew:crew-run <id>` is next.
