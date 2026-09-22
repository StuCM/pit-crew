# Map JSON schema

## Shape

```json
{
  "id": "arches-3d-viewer",
  "title": "3D viewer for Arches",
  "centre": "3D viewer for Arches",
  "summary": "One or two sentences on what the session was about.",
  "generated": "2026-09-20",
  "source": {
    "title": "3D viewer widget integration for multiple file formats",
    "url": "https://claude.ai/chat/acd43749-...",
    "turns": 14
  },
  "themes": [
    {
      "id": "t-mesh",
      "label": "Mesh viewers",
      "summary": "What this section covers, one sentence.",
      "colour": "#14a09a",
      "nodes": [ /* node objects */ ]
    }
  ]
}
```

`id` keys the browser's pruning store — keep it stable across rebuilds of the
same map, or the user's removals are lost.

`colour` is optional; sections fall back to a built-in palette in order.

`layout` is optional, top-level, and holds positions for nodes the user has
dragged: `{"n-o3dv": [412, -88], "t-mesh": [216, 0]}`. Anything listed overrides
the computed position; anything absent is laid out automatically. The viewer's
Removed panel emits this block, so the usual way to get one is to arrange the
map by hand and copy the result back.

## Node

```json
{
  "id": "n-o3dv",
  "label": "Online 3D Viewer",
  "status": "decided",
  "claim": "Chosen as the tier-1 renderer.",
  "rationale": "Widest format support of anything evaluated, MIT licensed.",
  "detail": "Longer prose for the document.\n\nBlank lines split paragraphs.",
  "evidence": [
    {"turn": 5, "speaker": "assistant", "quote": "Online 3D Viewer for the widget"}
  ],
  "children": [ /* nested nodes, same shape */ ]
}
```

### Fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique across the whole map. Prefix `t-` for sections, `n-` for nodes. |
| `label` | yes | 2–4 words. This is the bubble text. The validator warns above 5. |
| `status` | yes | One of the five below. |
| `claim` | no | One line, shown under the label in the outline and at the top of the sheet. |
| `rationale` | for `rejected` and `corrected` | The *why*. Rendered as "Why:" in the doc. |
| `detail` | no | Paragraphs for the document. `\n\n` splits them. |
| `evidence` | yes, at least one | See below. |
| `children` | no | Sub-ideas. Two levels below a section is plenty; three is too many. |

### Statuses

| Status | Glyph | Use for |
|---|---|---|
| `decided` | ✓ | Settled. Rendered solid. |
| `explored` | ~ | Discussed seriously, parked rather than ruled out. Tinted. |
| `rejected` | ✕ | Ruled out. Dashed outline, muted. **Must** have a `rationale`. |
| `open` | ? | Asked and unanswered, or explicitly deferred. Dotted outline. |
| `corrected` | ⤺ | A wrong assumption, estimate or reading that got fixed. **Must** have a `rationale` saying what changed. |

`corrected` is the one people skip. Use it for: the user correcting the
assistant, the assistant correcting the user, a mid-chat position the end of
the chat contradicts, and typos or misnamings that mattered.

### Evidence

```json
{"turn": 8, "speaker": "human", "quote": "I don't think this is months of work though"}
```

- `speaker` is `"human"` or `"assistant"`, rendered as "You" / "Claude"
- `quote` short and verbatim — a dozen words is plenty
- `turn` the turn number in the source chat
- Two quotes is often better than one: the raising and the resolving

A node with no evidence is a node you made up. The validator enforces this.

### Linking quotes back to the chat

If `source.url` is set, every quote's attribution line becomes a link that opens
the source chat in a new tab. Two optional refinements:

- `source.turn_url` — a template such as `"https://.../chat/abc#turn-{turn}"`.
  `{turn}` is substituted per quote. Only set this if the platform genuinely
  supports per-message anchors; claude.ai does not, so leave it off for Claude
  chats and quotes will link to the top of the conversation instead.
- `url` on an individual evidence object — overrides both, for a quote that came
  from somewhere else (a linked doc, a different chat).

## Worked examples

**A rejection that carries its reason:**

```json
{
  "id": "n-modelviewer",
  "label": "model-viewer",
  "status": "rejected",
  "claim": "Google's web component. Simplest option, wrong constraint.",
  "rationale": "GLTF/GLB only — kills it unless everything is converted at ingest.",
  "detail": "Kept explicitly as a later swap if GLB normalisation works out.",
  "evidence": [{"turn": 5, "speaker": "assistant", "quote": "GLTF only — kills it for me"}]
}
```

**A reversal, with both ends cited:**

```json
{
  "id": "n-onewidget",
  "label": "One shell, two renderers",
  "status": "corrected",
  "claim": "Reversed from an earlier lean toward separate widgets.",
  "rationale": "Mid-session the lean was separate widgets; by the end it resolved to one shell with a renderer switch.",
  "evidence": [
    {"turn": 5,  "speaker": "assistant", "quote": "Leaning separate"},
    {"turn": 13, "speaker": "assistant", "quote": "one widget component, but with two rendering modes"}
  ]
}
```

**An open question, not dressed up as resolved:**

```json
{
  "id": "n-graph",
  "label": "Digital Object graph",
  "status": "open",
  "claim": "Asked twice, never answered.",
  "rationale": "The widget needs to know which node holds the file — that is the binding point.",
  "evidence": [{"turn": 3, "speaker": "assistant", "quote": "What does the Digital Object model look like?"}]
}
```

## Common mistakes

- **Labels too long.** "Online 3D Viewer chosen for tier one" is a `claim`, not
  a `label`. The label is "Online 3D Viewer".
- **Sections that are phases.** "Early discussion", "Conclusions", "Next steps"
  are not topics and produce a map that tells you nothing.
- **Everything marked `decided`.** Most of a real planning chat is `explored`
  and `open`. A map of nine decisions and no open questions is a map that has
  been flattered into uselessness.
- **Rationale that restates the claim.** "Rejected because it was not suitable"
  is not a reason. Name the specific constraint.
- **Evidence paraphrased.** Quote verbatim or drop the node.
