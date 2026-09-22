# Architecture map schema

```json
{
  "id": "arches-3d-architecture",
  "title": "3D viewer for Arches — architecture",
  "summary": "One or two sentences on what this diagram shows.",
  "generated": "2026-09-20",
  "source": {
    "title": "3D viewer widget integration for multiple file formats",
    "url": "https://claude.ai/chat/acd43749-...",
    "turns": 14,
    "brainstorm": "https://claude.ai/artifact/..."
  },
  "groups": [{"id": "g-ingest", "label": "Ingest", "colour": "#3b82ac"}],
  "parts": [ /* part objects */ ],
  "edges": [ /* edge objects */ ],
  "layout": {"p-widget": [420, -60]}
}
```

`id` keys the browser's pruning and drag store — keep it stable across rebuilds.
`source.brainstorm` is the artifact link for the layer-1 map; trace chips link
there. `layout` is optional and holds dragged positions; the viewer emits it.

## Part

```json
{
  "id": "p-queue",
  "label": "Conversion worker",
  "group": "g-convert",
  "kind": "job",
  "status": "agreed",
  "purpose": "Picks up conversion jobs, runs the right converter, writes derivatives back.",
  "why_split": "nxsbuild on a 50-million-triangle mesh takes minutes. Nothing in a request cycle can wait.",
  "responsibilities": ["Select converter by format", "Update status"],
  "not": ["Deciding the tier at view time"],
  "interfaces": ["Reads: job queue", "Writes: file store, Digital Object"],
  "open": ["Same-server Celery worker, or a dedicated pod?"],
  "evidence": [{"turn": 11, "speaker": "assistant", "quote": "I'd start with the same-server Celery approach"}],
  "traces": [{"id": "n-where", "label": "Where it runs"}]
}
```

| Field | Required | Notes |
|---|---|---|
| `id`, `label` | yes | Label 2–3 words; the validator warns past 4. |
| `kind` | yes | `ui` `service` `job` `store` `external` `data`. |
| `status` | yes | `agreed` `proposed` `open` `deferred` `rejected`. |
| `purpose` | yes | What we think it does. No purpose means it is not a part. |
| `why_split` | yes | Why it is not folded into a neighbour. |
| `not` | no, but do it | What it is explicitly not responsible for. |
| `open` | no | Questions that would change the design. Renders a marker. |
| `evidence` or `traces` | at least one | Where it came from. |
| `group`, `responsibilities`, `interfaces` | no | |

`traces` entries are `{"id", "label"}` — and optionally `"url"` to override
`source.brainstorm`. The label is stored inline so the viewer never has to load
the layer-1 file.

## Edge

```json
{
  "id": "e-up-queue",
  "from": "p-upload",
  "to": "p-queue",
  "kind": "event",
  "label": "enqueue",
  "status": "agreed",
  "note": "The asynchronous boundary. Upload returns immediately.",
  "evidence": [{"turn": 11, "speaker": "assistant", "quote": "On upload, not on view"}]
}
```

`kind` is `data` (something flows), `depends` (needs it to exist), `control`
(invokes or selects) or `event` (fires and forgets). `label` is 1–3 words and
is drawn on the arrow. `note` is the "why this connection", shown when the
arrow is tapped and collected in the doc's Connections section.

Cycles are allowed. Back edges are detected, left out of the layering and drawn
dashed.

## Common mistakes

- **Boxes without boundaries.** Filling `purpose` and leaving `not` empty is
  how a part quietly grows to mean everything.
- **Arrows nobody can name.** If you cannot label it, the boundary is probably
  wrong. The validator warns on unlabelled edges.
- **Resolving open questions by guessing.** `open` is more useful than a
  confident invention. The questioning phase exists to close these.
- **Everything `agreed`.** A first architecture map is mostly `proposed`.
- **Parts with no trace.** If it came from neither the chat nor the brainstorm,
  it came from the model. Drop it or mark it `proposed` with an `open` entry
  asking whether it should exist.
