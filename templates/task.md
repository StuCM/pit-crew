---
id: NNN
slug: short-slug
status: draft
branch: crew/NNN-short-slug
model: sonnet
env: laptop
rounds: 0
part: <part id in the plan maps, or delete this line>
work: <slug of .claude/crew/work/<slug>.json, or delete this line>
files:
  - src/example.ts
  - test/example.test.ts
---

# <Title — what changes, in the user's terms>

## Goal
One or two sentences. What is different afterwards, from the outside.

## Why now
Which backlog item or decision this serves. One line.

## Background
<!-- What the person told /crew:crew-spec that the code does not say: what
     changed recently, a fix like this done before, the cause they suspect.
     Their words where they were precise. `None given.` if they had nothing. -->

## Assumed
<!-- Every decision in the Approach that neither the person nor the scout's
     [code] or [git] evidence settled, one line each. Approval starts here. -->

## Existing work
<!-- `npx crew collisions <this file>`, verbatim, plus one line on what you make
     of each hit after reading it. `None.` if it printed nothing, so the reader
     knows the question was asked. -->

## Graph context
<!-- Inlined by /crew:crew-spec from the memory graph. Workers must NOT re-query:
     if something is missing here, the spec is wrong — say so, don't go digging. -->

## The part this builds
<!-- `npx crew plan <this file>`, if `part:` is set. The spec carries this
     part's own purpose and boundaries; that command adds the neighbourhood —
     what it connects to, and what those neighbours are explicitly NOT for.
     The map is a reference, not an authority: where it and the code disagree,
     the code wins and the spec is wrong. -->

## Constraints that bite here
<!-- Only the ones that actually touch these files. Not the whole project brief. -->

## Approach
Numbered and specific. Name the functions and the call sites, so the worker
starts writing instead of exploring. If a step needs a decision the spec has
not made, that is a spec bug — stop and ask.

1.
2.

## Out of scope
Explicit. This is the list the reviewer checks scope creep against, so an
empty section means the reviewer will invent one.

-

## Definition of done
The reviewer executes this literally. Nothing here may be a matter of taste.

- [ ] <behaviour, observable>
- [ ] tests cover the behaviour, and fail if it regresses
- [ ] the gate passes (`npx crew gate <this file>`)
- [ ] no file outside `files:` is touched
- [ ] commits follow the convention (the hook enforces it)

## Scout requests
<!-- The worker appends one line per `crew-scout` question, at most two:
     the question, the answer in a line, and whether it changed the build. -->

## Review rounds
<!-- Reviewer appends one block per round. `rounds:` in the frontmatter counts
     them, and crew refuses to start one past the configured limit. -->

## Graph writes proposed
<!-- Worker and reviewer append; only the orchestrator commits them.
     Use the existing ontology: Decision (rationale, supersedes, affects),
     Pattern (a recurring approach, anti-pattern, or trap), Constraint,
     Preference. Do not invent relations. -->
