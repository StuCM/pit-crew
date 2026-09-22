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

## Two tiers

`brainstorm-map` and `open-threads` are conversations with a person and should
stay that way. `architecture-map`, `feature-map` and `agent-tasks` take inputs
and produce files, so an orchestrator can call them without being asked.

## The maps are not a second memory

Maps are the working surface for one piece of work. The graph is the durable
record. Confirmed decisions and dead ends go to the graph; the maps can then be
thrown away. Nothing queries both, because two stores drift and a drifting
store gives bad advice.
