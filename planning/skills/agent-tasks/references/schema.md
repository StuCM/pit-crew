# Task records and exporters

## What an exporter receives

`write(tasks, outdir, meta) -> [paths]`, where each task is:

```json
{
  "n": 1,
  "slug": "build-script",
  "title": "Build script",
  "goal": "Reads the map JSON, validates it, writes the HTML.",
  "why": "This is where the new output format hangs.",
  "part": "p-build",
  "status_in_map": "extend",
  "files": ["scripts/build_map.py"],
  "steps": ["In `scripts/build_map.py`, Add a --format argument... (`main`, line 71)."],
  "using":    [{"name": "build", "file": "...", "use": "call", "note": "..."}],
  "changing": [{"name": "main", "file": "...", "use": "modify", "change": "..."}],
  "out_of_scope": ["Anything in Mermaid writer — that is a separate task."],
  "done": ["Add a --format {html,mermaid,both} argument and branch after validation."],
  "blockers": [{"kind": "question", "text": "..."}],
  "traces": [{"id": "p-widget", "label": "Viewer widget"}],
  "evidence": [{"turn": 11, "speaker": "assistant", "quote": "..."}],
  "artifact": "https://claude.ai/artifact/...",
  "map_title": "Mermaid export for brainstorm-map"
}
```

`meta` is `{"plan": "<name>", "blocked": [<tasks held back>]}`.

`blockers` is empty on every task unless `--force` was used, so an exporter can
ignore it — but rendering it is better, since a forced run is exactly when
someone needs to see why.

## Writing one

```python
# scripts/exporters/linear.py
def write(tasks, outdir, meta):
    p = outdir / "linear.json"
    p.write_text(...)
    return [p]
```

Then add `"linear": linear.write` to `EXPORTERS` in `__init__.py`. That is the
whole extension point; `build_tasks.py` never needs editing.

Keep the mapping honest. If a tracker has no field for "out of scope", put it
in the description rather than dropping it — it is the list a reviewer checks
scope creep against, and losing it is how a task quietly grows.

## Statuses that produce tasks

Only feature-map parts with `extend` or `new`. `exists` is context, not work,
and `unknown` is a thread for `open-threads`.

An architecture map alone produces **no tasks** — it cannot say which files are
touched, and a task without files is not a task. The run reports each part it
skipped for that reason, which is a prompt to build the feature map.
