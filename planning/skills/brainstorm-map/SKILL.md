---
name: brainstorm-map
description: Turn a planning or design conversation into a brainstorm map plus a linked in-depth document — sections, ideas, rejected routes with reasons, corrections, and unresolved questions, all traced back to the chat. Use this whenever the user asks to map, diagram, mind-map, visualise, summarise or "pull out" a chat, planning session, design discussion or meeting; whenever they mention a brainstorm map, mind map, bubble diagram or session map; and whenever they want a readable record of what was decided, what was ruled out and why. Also use it when they want to prune or edit an existing map.
---

# Brainstorm map

Turns a long planning conversation into a two-sided mind map you can read on a
phone or a desktop, with an in-depth document behind it. Every bubble links to a section of
the document. Every node cites the chat it came from.

The point is **not** a summary. It is a record of the shape of the thinking:
what was decided, what was explored and parked, what was rejected and why, what
was misunderstood and corrected, and what was left open.

## The one rule that matters

**Extract, then cluster, then render — never all at once.**

Every failed attempt at this task fails the same way: one pass tries to read the
chat, judge it, group it and lay it out simultaneously, and invents plausible
themes that were never discussed. Do the passes separately. The later passes
must not see the raw transcript.

Layout is code, not judgement. Never hand-place coordinates or hand-write SVG
for the map — the viewer computes it at render time. Every topic owns an
angular wedge sized by its leaf count, its children own sub-wedges inside it,
and depth sets a base ring; clashes are resolved by pushing the outer node
further out along its own angle, which keeps it inside its parent's wedge.
The user can drag anything the relaxation leaves awkward.

## Workflow

### 1. Get the chat

Read the source conversation in full before writing anything.

- **A past chat**: `conversation_search` to find it, `read_conversation` to read
  it. Page through to the end — the last turns usually hold the decisions.
  Note: chats inside a project are only searchable from inside that project.
- **A pasted or uploaded transcript**: read the file.
- **A share link** (`claude.ai/share/...`): these render client-side, so a
  plain fetch returns an empty shell. A real browser renders them fine — in
  Claude Code, open it in the browser pane and read the page text. Only ask
  the user to paste it if you have no browser.

Number the turns. You need turn numbers for evidence.

### 2. Pass one — extract moves, do not cluster

Go through the chat turn by turn and produce a **flat** list of discourse moves.
No themes yet. For each move record: what it was, its status, one line of why,
and the turn it came from.

Look for:

- **Proposals** — an option put on the table, by either party
- **Decisions** — something settled
- **Rejections** — something ruled out, and the reason
- **Corrections** — a wrong assumption, a bad estimate, a misread requirement,
  later fixed. These are the most valuable and the most often lost.
- **Reversals** — a position held mid-chat that the end of the chat contradicts
- **Open questions** — asked and never answered, or explicitly parked

Resist the urge to tidy. A move the user raised and dropped is still a move.

### 3. Pass two — cluster

Working **only from the flat list**, group moves into 5–10 sections. If you find
yourself reaching back into the transcript to justify a section, the section is
yours, not theirs — drop it.

Sections are topics, not phases. "Mesh viewers" and "Conversion pipeline" are
sections. "Initial discussion" and "Next steps" are not.

Give one section over to corrections and scope changes if there are more than
one or two.

### 4. Pass three — verify

For every node, check the quote actually appears in the transcript, near the
turn recorded. Drop anything that fails. A map with 22 real nodes beats one with
34 where 12 are invented — and invented nodes are exactly what makes the user
distrust the whole thing.

### 5. Write the map JSON

See `references/schema.md` for the full schema and field-by-field guidance.
Read it before writing the file.

### 6. Build

```bash
python3 scripts/build_map.py map.json -o <name>.html
```

Write the HTML next to the JSON. With a crew planning layer present that is
`.claude/plans/maps/`, which is where `plan-init` puts maps and where
`crew plan` reads them; otherwise put it wherever the repo keeps generated
docs.

The script validates first and refuses to build on missing evidence, unknown
statuses, duplicate ids, or a rejected node with no stated reason. Fix the JSON
rather than passing `--skip-validation`.

### 7. Deliver

Publish the HTML as an artifact if the Artifact tool is available — that gives a
link that works on the phone. Otherwise present the file. Keep the JSON
alongside it; it is the editable source.

**Publish it with the capabilities its page actually asks for**, or the
comment thread is dead on arrival:

```
capabilities: {"db": {}, "sample": {}}
```

`db` is the shared store the comments are written to, so they survive a reload
and your colleagues see them; `sample` is what lets Claude answer a comment
inside the page. The template calls both and falls back to `null` when they
are absent, so a map published without them looks fine and silently drops
every comment on the floor.

Then say, briefly: how many sections and nodes, which sections hold the rejected
and open material, and anything you deliberately left out.

## What the output does

Three views, one file, no dependencies, works offline:

- **Map** — topics around a circle, children fanning outward as flat labels;
  pan, pinch-zoom, and drag any node (a drag carries its children with it)
- **Outline** — nested list, better on a narrow phone
- **Doc** — the in-depth write-up; every bubble has a "Read in doc" button that
  jumps to its section

**Prune mode** lets the user remove sections or nodes that got pulled in
wrongly. Removals persist in the browser and cascade to children. The Removed
panel restores them and offers cleaned JSON to copy back over the source file,
which is how pruning is made permanent.

## Judgement calls

**Sizing.** 5–10 sections, 3–8 nodes each. Under about 15 nodes the map is not
worth the format — say so and give a written summary instead. Node count drives
the map's height rather than crowding it, so large maps stay legible but get
tall; past about 60 nodes, look for near-duplicates to merge — but only merge
what is genuinely duplicated. A long session legitimately produces a big map:
22 turns of real back-and-forth came out at 75 distinct nodes with nothing
worth merging. Never drop rejected ones to get under a number.

**Balance the sections.** Wedge size follows leaf count, so one section holding
half the nodes squeezes every other section into a narrow slice. That is a
content signal — split the bloated section — not a layout problem to fix.

**Moved nodes are part of the map.** Dragging is remembered per browser, and
the cleaned JSON in the Removed panel carries a `layout` block of the moved
positions. Paste it back into the source file to make an arrangement permanent.

**Labels are 2–4 words.** The bubble carries the name; everything else lives in
`claim`, `rationale` and `detail`. Long labels are the main cause of an ugly map.

**Never drop rejected material.** The user asked for it explicitly and it is the
part a plain summary always loses. A rejected node without a stated reason is
worse than useless, so the validator blocks it.

**Attribution.** A suggestion the assistant made and the user did not take up is
still `explored` or `rejected` — not the user's decision. Keep `speaker` honest
in the evidence.

**Don't invent resolution.** If the chat ended mid-thread, the node is `open`.
Chats that trail off are normal and the map should show it.

## Editing an existing map

If the user wants changes to a map already built, edit the JSON and rebuild —
do not regenerate from the chat, which loses their pruning. If they have pruned
in the browser, ask them to copy the cleaned JSON from the Removed panel first.

## Files

- `references/schema.md` — the map JSON schema, statuses, worked examples
- `scripts/build_map.py` — validator and renderer
- `assets/template.html` — the viewer; edit here to change how maps look
- `example/map-arches-3d-viewer.json` — a real map from a 14-turn planning chat,
  useful as a reference for tone, density and evidence style
