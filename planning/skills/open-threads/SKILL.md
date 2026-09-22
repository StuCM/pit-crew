---
name: open-threads
description: Work through the unresolved parts of a plan as a conversation rather than a questionnaire. Ranks every open thread across brainstorm, architecture and feature maps by how much depends on it, opens the highest-leverage one with a position to argue against, and writes the outcome — a decision, a set of options, or a note — back into the maps. Use this when the user wants to think something through, resolve open questions, work out what to do next on a plan, challenge or explore a design decision, or close the gaps before handing work to agents.
---

# Open threads

The questioning phase between mapping and building. Its output is not answers —
it is a conversation that leaves the maps changed.

```
brainstorm-map → architecture-map → feature-map → open-threads → (agent tasks)
                           ↑______________________________|
                            resolutions are written back
```

## How a session runs

**One thread at a time.** Rank first, open the top one, stay there until it is
resolved or parked. Do not present a numbered list of twenty questions and wait
— that hands all the work back to the user and produces shallow answers.

**Open with a position, not a question.** A bare "what should the Digital
Object graph look like?" is the problem handed back. Instead: what you think,
why, and what would change your mind.

> I think the Digital Object has to carry the derivative list as a first-class
> node rather than a side table, because the widget reads that list to choose a
> renderer — it is on the critical path for every view. What I do not know is
> whether your graph is the stock reference model, which would make that a
> schema change rather than an addition. If it is stock, I would argue the
> opposite: keep derivatives in a separate resource and link them.

Then stop and let them push back.

**Let the user drive.** They will challenge the position, ask their own
questions, go sideways into something adjacent. Follow. A tangent that surfaces
a constraint is worth more than finishing the thread you opened. If the tangent
turns out to be a different thread on the map, say so and ask whether to switch.

**Do not converge to be agreeable.** The failure mode of open conversation is
drifting into pleasant agreement. If you still disagree after their argument,
say so and say why. Record disagreement rather than smoothing it — "we did not
settle this, here is where we each stood" is a legitimate and useful outcome.

**End with one of three things:**

| Outcome | When | What gets written |
|---|---|---|
| **Decided** | The user made a call | `--decided` + `--why`, question closes, status may change |
| **Options** | Real alternatives, no decision | `--options` + `--why`, question stays open |
| **Note** | Explored, nothing settled | `--note`, nothing else changes |

Offering options is a proper outcome, not a failure. When a conversation has
narrowed the field without picking, write the survivors down with what ruled
the others out — that is most of the value of having talked.

## Cover the ground — do not just answer the question

The user wants a thread genuinely worked over, not politely acknowledged. For
each thread, push on the angles that are usually missed. Ask about them as
the conversation makes them relevant, not as a checklist read aloud:

- **Failure** — what happens when this part fails, is slow, or is half-done?
  The upload-conversion boundary is the obvious case: what does a viewer see
  between upload and conversion finishing?
- **Scale and limits** — what size, volume or rate breaks the assumption? Ask
  for a number. "Large files" is not an answer; "a 40-million-triangle scan"
  is.
- **Who owns it** — is this ours, a library's, or a third party's problem when
  it breaks?
- **Migration and existing data** — what about everything already in the
  system before this exists?
- **The reverse** — what would have to be true for the opposite choice to win?
  If nothing would, the decision is stronger than it looked; if something
  would, that is the thing to go and check.
- **Cost of being wrong** — is this reversible in an afternoon or baked into a
  schema?
- **Who else is affected** — other parts, other people, other clients on the
  same platform.

Two or three of these per thread, chosen for the thread, not all seven every
time. A thread is not done because a question was answered; it is done when
you cannot think of a way the answer breaks.

If the user gives a vague answer, say so and ask again. "Probably fine" is not
a resolution, and recording it as one puts a guess into the map where it will
be read later as a decision.

## The rule that matters

**Only `--decided` when the user decided.** If you proposed something and they
said "sounds good", that is agreement with your suggestion, not their decision —
use `--options` or `--note`, or ask them directly whether to call it settled.
This is the same stated-versus-suggested line the brainstorm skill draws, and
it matters more here, because a decision written into the map becomes the
premise for everything downstream.

If you are unsure which outcome applies, ask. One short question at the end of
a session is fine; twenty at the start is not.

## Workflow

1. **Rank**, across every map the user has. If there is a `plan.json`
   manifest, pass that instead of listing files:
   ```bash
   python3 scripts/rank_threads.py plan.json --top 5
   python3 scripts/rank_threads.py brainstorm.json arch.json feature.json --top 5
   ```
   Threads are grouped by part, because leverage is a property of the part.
   Each prints its own reasoning — downstream parts, connections, how many
   other questions name it — so the user can disagree with the order.

2. **Show the top two or three briefly**, then open the first one properly.
   Offer to start elsewhere: the ranking is computed from structure and knows
   nothing about what is urgent this week.

3. **Have the conversation.** Position, challenge, explore.

4. **Write it back:**
   ```bash
   python3 scripts/resolve.py --map arch.json --part p-digobj \
     --question "standard Arches reference" \
     --decided "..." --why "..." --status agreed
   ```
   Use `--dry-run` first on anything that closes a question. `--question` takes
   a substring and refuses on an ambiguous match rather than guessing.

5. **Rebuild the affected map** with its own skill's build script so the
   diagram reflects the session, and say what changed.

6. **Offer the next thread.** Do not start it unasked.

## Judgement calls

**Ranking is a suggestion.** It measures structural leverage, not urgency, cost
or who is blocked on Friday. Say that when presenting it.

**A thread with no dependants is not worthless** — it is cheap to settle, or a
candidate to drop from the map entirely. Both are useful outcomes.

**Unverified symbols are threads too**, but they are not conversations: the
answer is to go and read the repo. Flag them, do not discuss them.

**Never invent the answer to close a thread.** An open question that survives a
session is fine. A question closed with a plausible guess is worse than one
left open, because it stops being visible.

## Runs anywhere

Maps are small JSON files, so this works in chat as well as Claude Code — paste
or upload the maps. Unlike `feature-map`, there is no repo requirement, with
the one exception above: verifying symbols needs the code.

## Files

- `scripts/plan.py` — create and inspect a `plan.json` manifest that ties one
  project's maps (and their artifact links) together
- `references/session.md` — how to open a thread, worked examples of each outcome
- `scripts/rank_threads.py` — collects and orders open threads across maps
- `scripts/resolve.py` — writes a decision, options or note back into a map
- `example/` — the three Arches maps, for trying the ranking against real data
