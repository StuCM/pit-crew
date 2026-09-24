---
name: crew-spec
description: Route a piece of work before any code changes — straight to a spec, inline, or an offer to plan first. Use in a crew repository whenever the user asks for a bug to be fixed, a feature added or something changed, even a small one, and before editing code for it; also for "spec this", "let's plan X", or a backlog item. Not for questions about how existing code already works.
---

# Routing a piece of work, then specifying it

You are the orchestrator. You hold the conversation, the project, and the
reasons. This skill produces the one artifact everything else runs on.

Three standing rules. The first two pull in opposite directions on purpose.

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

**You do not do the digging.** Searching the history, walking the graph and
reading the files a fix will touch belong to `crew-scout`, which reads
everything and returns a page. If you do it yourself, your context fills with
file dumps, and you stop being the one who keeps track of the whole piece of
work. The same goes for a broad question mid-conversation: hand it to an
Explore agent and keep the answer, not the search.

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
| "how does X work?", "where is Y?", "why does it do Z?" | **exploration** | Answer it, through an Explore agent if it means reading more than a file or two. No spec, no map, no worktree. If it turns into work, you will be back here. |
| "fix this typo", "bump the version", a one-line revert | **too small for the loop** | Say you are doing it inline, and do it. |
| a bug with a known cause in a file you can name | **a task** | Step 1, one or two questions at most. Offer nothing. |
| several fixes in the same area, or "a few things are broken since X" | **one piece of work with several tasks** | Step 1 and one scout for all of them. They probably share a cause, and scouting them separately finds it N times or not at all. |
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
  maps. Do not rewrite one. The planning conversation already did step 1, so
  do the three things the draft deliberately did not: the graph (a scout, step
  2, with the part's symbols as leads), collisions, and approval.
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

## 1. Ask what they know

On an existing codebase, most of the context a worker needs is in the
person's head, not in the repository — and nobody writes it down unless
someone asks. "The concept nodes all became references in the upgrade" is one
sentence to them, and it is the difference between a spec that finds the root
cause and a worker that patches one symptom of twelve.

**Ask before you scout, and before you read any code yourself**, so the
scout knows what to look for and you have not already decided the cause. One message,
three to five questions picked from below for this kind of work, numbered so
they can be answered by number. Say "I don't know" is a fine answer. Skip any
question already answered in the conversation, and never ask all of them.

**When they say go, go.** If the person has answered some questions and tells
you to scout, spec or get on with it, ask nothing more in this step: send the
scout, and let its **Open** list carry whatever is still unknown. A second
round of questions after "go ahead" is the friction this step exists to
avoid.

**What changed.**
1. Did something change recently that this work is a consequence of — an
   upgrade, a migration, a rename, a data type or schema changing shape?
2. When did it last work, and what happened in between?

**Have we been here before.**
3. Have you fixed something like this already, here or in another project?
   Where — a PR, a branch, a commit?
4. Is there a helper, pattern or convention for this that the fix should use?
5. Do you think these are symptoms of one cause, or separate problems?

**Where it shows.**
6. How do you see it fail — which screen, workflow, command or error?
7. Which part of the code do you suspect, and which are you sure is fine?

**What done means.**
8. How will you know it is fixed, and where can that be seen — tests, a local
   run, staging, a person clicking through?
9. What data or setup does it need to reproduce?

**Limits.**
10. What must not change — behaviour, a file, a contract other code relies on?
11. Is anyone else working in this area right now?

Pick by shape. A regression wants 1, 2, 3 and 6. Several fixes want 1, 3 and 5.
A feature in an existing system wants 4, 7 and 10. Question 8 earns its place
almost always.

Then **play back what you heard in two or three lines** before moving on.
Checking it back like this is cheap, and it is where "references, not concepts"
gets corrected before it reaches a spec.

Everything answered here goes into the spec's **Background** section, in the
person's words where they were precise. It is the only place a worker learns
it.

## 2. Scout — one agent, once

Spawn it with the Agent tool: `subagent_type` `crew:crew-scout` (or
`crew-scout` where the plugin is not namespaced). Give it the work in the
person's words and the answers above as **leads**. For several fixes, give it
all of them together, in one agent.

**Between the answers and the scout's brief, do not read, grep or glob the
repository yourself**, not even to check a lead first. Every file you open
here is context the scout was meant to hold instead of you, and a search you
start is one you will be tempted to finish. If the brief comes back short,
send the scout back with the follow-up.

Run it in the foreground and wait for it. Do not open the files it names to
check its work while you wait, or after: its lines say where each claim came
from, and one marked `unverified` is a question for the scout or the person,
not a file for you to read.

It searches the git history and changelog for the same fix done before,
follows chains through the memory graph (`crew graph chain`) from each lead,
finds the real files, call sites, helpers and tests, and asks the graph about
those exact paths. It returns a page, with every line tagged by where it came
from.

Then **record it for the pit wall** in `.claude/crew/work/<slug>.json`, so the
person can read it, answer it and open the files from `crew serve` rather
than scrolling back through this conversation:

```json
{
  "title": "Controlled-list comparisons after the v8 upgrade",
  "summary": "One or two sentences: what is wrong, and the cause if known.",
  "stage": "scout",
  "questions": [
    { "id": "q-other-callers", "q": "The question, as the scout put it.",
      "why": "Why the answer changes the spec.",
      "refs": [{ "path": "coral/functions/notify_smm.py", "line": 45, "name": "post_save" }] }
  ],
  "gaps": [{ "id": "n-hub", "text": "Where it stopped short.", "next": "What it would run next." }],
  "findings": [
    { "title": "Root cause", "rows": [{ "src": "git", "text": "…", "refs": [{ "path": "…", "line": 1 }] }] }
  ]
}
```

Every question that is about code carries its `refs`. `stage` is one of
`ask`, `scout`, `spec`, `approve`, `build`, `review`, `close`; move it on as
the work does.

One file per piece of work, named for it, so several can be in flight in one
repository without overwriting each other. Every task you write for it gets
`work: <slug>` in its frontmatter; that is how the page groups them.
Answers and gap decisions in `wall.json` are keyed `<slug>:<question id>`.

Read what comes back and keep only what bears on the spec:

- **Root cause** and **Done before** shape the Approach. A previous fix's
  shape is the best Approach there is; name its commit.
- **Reuse** goes into Approach by name. A worker that is not told about the
  helper writes a second one.
- **Files and call sites** become `files:`.
- **Traps** go into **Graph context**, compressed, in your own words. A trap
  recorded against a file the task is about to edit is the single
  highest-value line a spec can carry.
- **Open** goes back to the person — do not answer it yourself.
- **Needed more** is the scout saying where it stopped short. Decide each
  one: send the scout back with that one follow-up, put it to the person, or
  accept the gap and name it in the spec's Background so the worker knows it
  is there. Never pass over one without deciding.

This is still one read per task, filtered by someone with judgement, and
workers stay hermetic: they need no graph, no network, and no memory of
previous sessions. If the graph CLI is absent the scout says so and works from
git and the code alone; the loop does not stall.

**Skip the scout** only for a task whose files and fix the person has already
named, or one too small for the loop. Say that you are skipping it.

## 3. Establish what the task actually is

Talk it through with the user. Push on:

- **What is different afterwards, from the outside?** If you cannot say it in
  a sentence, the task is too big — split it.
- **Which files?** From the scout's list. The `files:` list is a contract —
  the scope hook refuses a write outside it — so a missing one blocks the
  worker. If the scout found the same cause in more files than the person
  mentioned, ask whether they are this task or the next one.
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

## 4. Write it

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

## 5. Get approval — this is a hard gate

If `crew serve` is running, the person may answer and approve there instead.
Before you write or revise a spec, read `.claude/crew/wall.json`:

- `answers` — replies to the scout's questions, by id. They go into
  Background, as if given here.
- `gaps` — `follow` or `accept` for each place the scout stopped short.
- `marks` — text they selected in a spec and called wrong, asked to change,
  or asked about. Deal with each, then set its `status` to `resolved` and
  give it a one-line `reply`, so the page shows it was read.

A task the page approved already says `status: approved` and has its `spec`
log line; do not ask again.

Do not open with the whole spec and a yes/no question. That asks the person
to find the gaps themselves, and they will skim it. Lead with what they can
check in thirty seconds:

- the Goal, in one sentence
- `files:`
- **what you assumed**: every decision in the Approach that neither the
  person nor the scout's `[code]` or `[git]` evidence settled, one line each
- anything the scout marked `unverified` that the spec relies on

Then ask about those points, not about the spec in general. The full file is
there for anyone who wants it.

**Do not spawn a worker until they say yes.** They asked for this gate for a
reason: a wrong spec is the most expensive thing in the system, and it is
cheapest to fix right now.

On approval set `status: approved`, run `npx crew log <task> spec`, and tell
them `/crew:crew-run <id>` is next.

## When the conversation moves

People ask about something else halfway through a spec. That is normal; it
does not mean the spec is abandoned, and it does not mean the new thing gets
built inline.

- **A question** — answer it briefly, through an Explore agent if it needs
  reading. Then say where you are: "back to task 004, still waiting on your
  answer to question 3."
- **New work** — write it down as a one-line stub in `.claude/tasks/` with
  `status: draft`, and carry on with the current spec. It gets its own trip
  through this skill later.
- **The person changes their mind about this work** — that is not a detour.
  Go back to step 1 with what changed.

Never pick up the new thing yourself because you happen to have the context.
That is the drift the first rule exists to stop.
