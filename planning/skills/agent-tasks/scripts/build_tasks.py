#!/usr/bin/env python3
"""Assemble agent task packets from a plan's maps.

    python3 scripts/build_tasks.py plan.json -o tasks/
    python3 scripts/build_tasks.py plan.json -o tasks/ --format crew
    python3 scripts/build_tasks.py plan.json -o tasks/ --format markdown,crew,taiga
    python3 scripts/build_tasks.py plan.json --check      # gate only, write nothing

Nothing here is invented. Every field is lifted from the maps: the feature map
says which files and symbols, the architecture map says what the part is for
and what it is explicitly not, and both carry the trace back to the chat.

The gate is the point. A part with unresolved questions or unverified symbols
does not become a task — it becomes a blocker, and the blockers are listed so
they can be taken to `open-threads` or checked against the repo.
"""
import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from exporters import EXPORTERS  # noqa: E402

BUILDABLE = {"extend", "new"}          # feature-map statuses that mean work
LAYERS = ("brainstorm", "architecture", "feature")


def slugify(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")[:48]


def load_plan(path):
    p = pathlib.Path(path)
    d = json.loads(p.read_text(encoding="utf-8"))
    if d.get("parts") or d.get("themes"):          # a bare map, not a manifest
        return {"name": d.get("title", "plan")}, {"feature" if d.get("parts") and
                any(x.get("surface") for x in d["parts"]) else "architecture": d}
    maps = {}
    for layer in LAYERS:
        m = (d.get("maps") or {}).get(layer)
        if not m:
            continue
        f = (p.parent / m["file"])
        if f.is_file():
            maps[layer] = json.loads(f.read_text(encoding="utf-8"))
            maps[layer]["_artifact"] = m.get("artifact")
    return d, maps


def order_parts(parts, edges):
    """Dependency order: a part comes after anything it depends on."""
    ids = [p["id"] for p in parts]
    deps = {i: set() for i in ids}
    for e in edges:
        if e.get("from") in deps and e.get("to") in deps:
            # "A depends on B" and "A reads B" both mean B should exist first
            if e.get("kind") in ("depends", "data"):
                deps[e["from"]].add(e["to"])
    out, seen = [], set()

    def visit(i, stack):
        if i in seen or i in stack:
            return
        stack.add(i)
        for d in sorted(deps[i]):
            visit(d, stack)
        stack.discard(i)
        seen.add(i)
        out.append(i)

    for i in ids:
        visit(i, set())
    by = {p["id"]: p for p in parts}
    return [by[i] for i in out]


def blockers_for(part, arch_by_id):
    out = []
    for q in part.get("open") or []:
        out.append({"kind": "question", "text": q})
    for s in part.get("surface") or []:
        if not s.get("verified") and s.get("use") != "add":
            out.append({"kind": "unverified",
                        "text": f"{s.get('name')} in {s.get('file')} has not been confirmed in the repo"})
    a = arch_by_id.get(part.get("traces", [{}])[0].get("id")) if part.get("traces") else None
    for q in (a or {}).get("open") or []:
        out.append({"kind": "question", "text": f"(architecture) {q}"})
    return out


def build(plan, maps):
    feature = maps.get("feature")
    arch = maps.get("architecture")
    arch_by_id = {p["id"]: p for p in (arch or {}).get("parts") or []}

    if not feature:
        # An architecture map alone cannot say which files to touch, and a task
        # without files is not a task — crew's `files:` is a scope contract.
        return [], [{"part": p.get("label"), "why": "no feature map: nothing says which files this touches"}
                    for p in (arch or {}).get("parts") or []
                    if p.get("status") in ("agreed", "proposed")]

    parts = [p for p in feature.get("parts") or [] if p.get("status") in BUILDABLE]
    parts = order_parts(parts, feature.get("edges") or [])

    tasks, blocked = [], []
    for i, p in enumerate(parts, 1):
        bl = blockers_for(p, arch_by_id)
        trace = (p.get("traces") or [{}])[0]
        a = arch_by_id.get(trace.get("id")) or {}
        changing = [s for s in p.get("surface") or []
                    if s.get("use") in ("modify", "replace", "add")]
        using = [s for s in p.get("surface") or []
                 if s.get("use") in ("call", "read", "subclass")]

        files = sorted({s["file"] for s in p.get("surface") or [] if s.get("file")}
                       | set(p.get("where") or []))

        steps = []
        for s in changing:
            steps.append(f"In `{s.get('file')}`, {s.get('change') or 'make the change'} "
                         f"(`{s.get('name')}`"
                         + (f", line {s['line']}" if s.get("line") else "") + ").")
        for s in using:
            if s.get("note"):
                steps.append(f"Use `{s.get('name')}` from `{s.get('file')}` unchanged — {s['note']}")

        out_of_scope = list(p.get("not") or []) + list(a.get("not") or [])
        for other in parts:
            if other["id"] != p["id"]:
                out_of_scope.append(f"Anything in {other.get('label')} — that is a separate task.")

        # For a new part the purpose IS the outcome; for an existing one it
        # describes what already works, so only the changes belong here.
        done = []
        if p.get("status") == "new" and p.get("purpose"):
            done.append(p["purpose"].rstrip(".") + ".")
        for s in changing:
            if s.get("change"):
                done.append(s["change"].rstrip(".") + ".")
        if not done and p.get("purpose"):
            done.append(p["purpose"].rstrip(".") + ".")

        tasks.append({
            "n": i,
            "slug": slugify(p.get("label", p["id"])),
            "title": p.get("label", p["id"]),
            "goal": p.get("purpose", ""),
            "why": p.get("why_here") or a.get("why_split") or "",
            "part": p["id"],
            "status_in_map": p.get("status"),
            "files": files,
            "steps": steps,
            "using": using,
            "changing": changing,
            "out_of_scope": out_of_scope,
            "done": done,
            "blockers": bl,
            "traces": p.get("traces") or [],
            "evidence": (a.get("evidence") or []),
            "artifact": feature.get("_artifact") or (arch or {}).get("_artifact"),
            "map_title": feature.get("title", ""),
        })
        if bl:
            blocked.append({"part": p.get("label"), "why": f"{len(bl)} unresolved item(s)"})
    return tasks, blocked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("-o", "--out", default="tasks")
    ap.add_argument("--format", default="markdown",
                    help="comma-separated: " + ", ".join(sorted(EXPORTERS)))
    ap.add_argument("--check", action="store_true", help="report the gate, write nothing")
    ap.add_argument("--force", action="store_true",
                    help="emit blocked tasks anyway, each carrying its blockers")
    a = ap.parse_args()

    plan, maps = load_plan(a.plan)
    if not maps:
        sys.exit("that plan points at no readable maps")
    tasks, blocked = build(plan, maps)

    ready = [t for t in tasks if not t["blockers"]]
    held = [t for t in tasks if t["blockers"]]

    print(f"{plan.get('name', 'plan')}: {len(ready)} ready, {len(held)} blocked")
    for t in held:
        print(f"\n  BLOCKED  {t['title']}")
        for b in t["blockers"]:
            print(f"    - [{b['kind']}] {b['text']}")
    for b in blocked:
        if not any(t["title"] == b["part"] for t in held):
            print(f"\n  SKIPPED  {b['part']}: {b['why']}")

    if held and not a.force:
        print("\nBlocked tasks are not written. Take the questions to open-threads, or "
              "verify the symbols with feature-map --repo, then run again. "
              "Use --force to write them anyway with their blockers attached.")
    if a.check:
        return

    emit = ready if not a.force else tasks
    if not emit:
        print("\nNothing to write.")
        return

    outdir = pathlib.Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)
    meta = {"plan": plan.get("name", "plan"), "blocked": held}
    for fmt in [f.strip() for f in a.format.split(",") if f.strip()]:
        if fmt not in EXPORTERS:
            sys.exit(f"unknown format {fmt!r} — have: {', '.join(sorted(EXPORTERS))}")
        written = EXPORTERS[fmt](emit, outdir, meta)
        for w in written:
            print(f"  wrote {w}")


if __name__ == "__main__":
    main()
