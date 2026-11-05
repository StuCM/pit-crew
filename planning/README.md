# planning

Plan a piece of work from conversation to agent-ready tasks, then hand the
durable parts to the memory graph.

```
chat ─▶ brainstorm-map ─▶ architecture-map ─▶ feature-map ─▶ open-threads ─▶ agent-tasks ─▶ crew ─▶ taiga-mirror
                                  │                │              │                │
                                  └── traces ──────┴── plan.json ─┴── decisions ────┴─▶ graph_propose
```

| Skill | What it does | Needs a repo |
|---|---|---|
| `brainstorm-map` | a planning chat becomes a map of what was decided, ruled out, corrected and left open | no |
| `architecture-map` | the parts that implies, how they connect, what each is explicitly not | no |
| `feature-map` | the slice of an existing codebase a feature meets, with every symbol verified | **yes** |
| `open-threads` | works the unresolved parts as a conversation, writes the outcome back | no |
| `agent-tasks` | task packets in dependency order; refuses anything unresolved | no |
| `taiga-mirror` | crew task state pushed to Taiga as a read-only board | no |

`scripts/plan.py` ties a project's maps into one `plan.json`.
`scripts/graph_propose.py` turns confirmed outcomes into proposed graph nodes.
`/plan-init` scaffolds both in a repo.

## plan.json

One `plan.json` is one exploration of an idea; its `name` is the exploration's
name, not the project's. Optional keys:

- `destination`: a string, what the exploration is trying to reach.
- `out_of_scope`: `[{"what", "why"}]`, work beyond the destination. It never comes back as a thread.
- `fog`: `[string]`, questions that cannot yet be stated precisely.

A question is a thread only if it can be stated precisely now; otherwise it is fog.

## Two tiers

`brainstorm-map` and `open-threads` are conversations with a person and should
stay that way. `architecture-map`, `feature-map` and `agent-tasks` take inputs
and produce files, so an orchestrator can call them without being asked.

## The maps are not a second memory

Maps are the working surface for one piece of work. The graph is the durable
record. Decisions reach the graph as they are made (`graph_propose.py --only <id>`),
under Project -> `<project> planning` -> the plan; the maps can then be
thrown away once the plan is done. Nothing queries both, because two stores drift and a drifting
store gives bad advice.
