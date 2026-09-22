"""Task specs in the shape crew expects: .claude/tasks/NNN-slug.md.

Deliberately emitted as `status: draft`. crew's approval gate is the point of
that system, and a generated spec has not been through it — the orchestrator
still runs `npx crew collisions`, fills Graph context from the memory graph,
and gets the user to approve before anything dispatches.
"""


def _spec(t, meta):
    files = t["files"] or ["TODO — no files recorded on this part"]
    L = ["---",
         f"id: {t['n']:03d}",
         f"slug: {t['slug']}",
         "status: draft",
         f"branch: crew/{t['n']:03d}-{t['slug']}",
         "model: sonnet",
         "env: laptop",
         "rounds: 0",
         "files:"]
    L += [f"  - {f}" for f in files]
    L += ["---", "", f"# {t['title']}", "", "## Goal", t["goal"] or "TODO", "",
          "## Why now", t["why"] or "TODO", "",
          "## Existing work",
          "<!-- Not run by the generator. The orchestrator must run "
          "`npx crew collisions` on this file before approval. -->", "",
          "## Graph context",
          "<!-- Generated from the plan maps, not the memory graph. The orchestrator "
          "should prime the graph and merge anything that bears on these files. -->"]
    if t["traces"]:
        L.append("")
        for x in t["traces"]:
            L.append(f"- Traces to **{x.get('label', x.get('id'))}** in the plan maps.")
    if t.get("artifact"):
        L.append(f"- Map: {t['artifact']}")
    for e in (t.get("evidence") or [])[:2]:
        who = "the user" if e.get("speaker") == "human" else "Claude"
        L.append(f"- From the planning chat ({who}, turn {e.get('turn')}): \"{e.get('quote')}\"")
    L += ["", "## Constraints that bite here"]
    if t["using"]:
        for s in t["using"]:
            L.append(f"- `{s.get('name')}` in `{s.get('file')}` is used, not changed."
                     + (f" {s.get('note')}" if s.get("note") else ""))
    else:
        L.append("<!-- none recorded on this part -->")
    L += ["", "## Approach"]
    L += [f"{i}. {s}" for i, s in enumerate(t["steps"], 1)] or ["1. TODO"]
    L += ["", "## Out of scope"]
    L += [f"- {s}" for s in t["out_of_scope"]] or ["- TODO"]
    L += ["", "## Definition of done"]
    L += [f"- [ ] {s}" for s in t["done"]]
    L += ["- [ ] tests cover the behaviour, and fail if it regresses",
          "- [ ] the gate passes (`npx crew gate <this file>`)",
          "- [ ] no file outside `files:` is touched",
          "- [ ] commits follow the convention (the hook enforces it)"]
    if t["blockers"]:
        L += ["", "## Blocked", "",
              "**Do not approve while these stand.**"]
        L += [f"- [{b['kind']}] {b['text']}" for b in t["blockers"]]
    L += ["", "## Review rounds", "", "## Graph writes proposed", ""]
    return "\n".join(L) + "\n"


def write(tasks, outdir, meta):
    d = outdir / "crew"
    d.mkdir(parents=True, exist_ok=True)
    out = []
    for t in tasks:
        p = d / f"{t['n']:03d}-{t['slug']}.md"
        p.write_text(_spec(t, meta), encoding="utf-8")
        out.append(p)
    return out
