#!/usr/bin/env python3
"""Decide how a plan lands in Taiga — epics, stories, tasks, sprint or kanban —
from a small config file and the shape of the plan itself.

    python3 scripts/taiga_layout.py plan.json                 # uses .claude/taiga.json
    python3 scripts/taiga_layout.py plan.json --config x.json
    python3 scripts/taiga_layout.py --init                    # write a starter config
    python3 scripts/taiga_layout.py plan.json --explain       # why it chose what it chose

Prints a push plan: what to create, in which order, under which parent. The
push itself goes through the Taiga MCP; this decides, so the model does not.

`structure: auto` reads the plan rather than a flag:

- a feature map dominated by existing code (`exists`, `extend`) is a feature
  into a live system, so it becomes one story with tasks under it
- a plan whose work is mostly new parts grouped into areas is a build, so the
  groups become epics, the parts stories, and the changes tasks
"""
import argparse
import json
import pathlib
import sys

DEFAULT_CONFIG = pathlib.Path(".claude/taiga.json")

DEFAULTS = {
    "project": "",
    "board": "kanban",
    "structure": "auto",
    "sprint": "none",
    "crewUnit": "auto",
    "tags": ["plan"],
    "attributes": ["branch", "env", "model", "rounds"],
    "comments": ["building", "blocked", "pending", "done"],
    "statuses": {
        "draft": "New", "approved": "Ready", "building": "In progress",
        "review": "In progress", "blocked": "In progress",
        "pending": "Ready for test", "done": "Done"
    }
}

ALLOWED = {
    "board": {"kanban", "scrum"},
    "structure": {"auto", "tasks", "stories", "epics"},
    "crewUnit": {"auto", "story", "task"},
}

STARTER = {
    "$comment": "How plans and crew work are written into Taiga. One-way: Taiga never drives crew.",
    "project": "your-taiga-project-slug",
    "board": "kanban",
    "structure": "auto",
    "sprint": "none",
    "crewUnit": "auto",
    "tags": ["plan"],
    "attributes": ["branch", "env", "model", "rounds"],
    "comments": ["building", "blocked", "pending", "done"],
    "statuses": DEFAULTS["statuses"],
}


def load_config(path):
    cfg = json.loads(json.dumps(DEFAULTS))
    p = pathlib.Path(path)
    if p.is_file():
        user = json.loads(p.read_text(encoding="utf-8"))
        for k, v in user.items():
            if k.startswith("$"):
                continue
            if k == "statuses":
                cfg["statuses"].update(v)
            else:
                cfg[k] = v
    errs = []
    for k, ok in ALLOWED.items():
        if cfg[k] not in ok:
            errs.append(f"{k}: {cfg[k]!r} is not one of {sorted(ok)}")
    if cfg["board"] == "kanban" and cfg["sprint"] not in ("none", "", None):
        errs.append("sprint is set but board is kanban — Taiga kanban has no sprints. "
                    "Set board to scrum, or sprint to none.")
    if cfg["board"] == "scrum" and cfg["sprint"] in ("none", "", None):
        errs.append("board is scrum but sprint is none — stories will land in the backlog. "
                    "Set sprint to current, or to a sprint name, if that is not what you want.")
    return cfg, errs


def load_maps(plan_path):
    p = pathlib.Path(plan_path)
    d = json.loads(p.read_text(encoding="utf-8"))
    maps = {}
    for layer in ("brainstorm", "architecture", "feature"):
        m = (d.get("maps") or {}).get(layer)
        if m and (p.parent / m["file"]).is_file():
            maps[layer] = json.loads((p.parent / m["file"]).read_text(encoding="utf-8"))
    return d, maps


def choose(cfg, maps):
    """Pick the structure, and say why — the user should be able to disagree."""
    if cfg["structure"] != "auto":
        return cfg["structure"], f"set explicitly to {cfg['structure']!r} in the config"
    feat = maps.get("feature")
    if feat:
        parts = feat.get("parts") or []
        existing = sum(1 for p in parts if p.get("status") in ("exists", "extend"))
        new = sum(1 for p in parts if p.get("status") == "new")
        if existing >= new:
            return "tasks", (f"feature into a live system: {existing} existing part(s) "
                             f"against {new} new")
        groups = {p.get("group") for p in parts if p.get("status") in ("new", "extend")}
        if len(groups) > 1:
            return "epics", f"mostly new work ({new} new parts) across {len(groups)} areas"
        return "stories", f"mostly new work ({new} new parts) in a single area"
    arch = maps.get("architecture")
    if arch:
        # count only areas that contain actual work — an area whose only part
        # is still open or deferred produces no epic, so it should not be counted
        groups = {p.get("group") for p in arch.get("parts") or []
                  if p.get("status") in ("agreed", "proposed")}
        if len(groups) > 1:
            return "epics", f"architecture only, {len(groups)} areas — a new build"
        return "stories", "architecture only, one area"
    return "stories", "no architecture or feature map; defaulting to stories"


def build(plan, maps, cfg, structure):
    """The push plan. Order matters: parents first, so children can reference them."""
    feat = maps.get("feature") or {}
    arch = maps.get("architecture") or {}
    source = feat if feat.get("parts") else arch
    parts = [p for p in source.get("parts") or []
             if p.get("status") in ("new", "extend", "agreed", "proposed")]
    groups = {g["id"]: g.get("label", g["id"]) for g in source.get("groups") or []}

    def changes(p):
        return [s for s in p.get("surface") or []
                if s.get("use") in ("modify", "replace", "add") and s.get("change")]

    items = []
    if structure == "tasks":
        story = {"level": "story", "key": "feature",
                 "subject": plan.get("name") or source.get("title", "Feature"),
                 "description": source.get("summary", "")}
        items.append(story)
        for p in parts:
            items.append({"level": "task", "key": p["id"], "parent": "feature",
                          "subject": p.get("label"), "description": p.get("purpose", ""),
                          "blocked": bool(p.get("open"))})
    else:
        if structure == "epics":
            for gid in sorted({p.get("group") for p in parts if p.get("group")}):
                items.append({"level": "epic", "key": gid,
                              "subject": groups.get(gid, gid), "description": ""})
        for p in parts:
            items.append({"level": "story", "key": p["id"],
                          "parent": p.get("group") if structure == "epics" else None,
                          "subject": p.get("label"), "description": p.get("purpose", ""),
                          "blocked": bool(p.get("open"))})
            for s in changes(p):
                items.append({"level": "task", "key": f"{p['id']}:{s.get('name')}",
                              "parent": p["id"], "subject": s.get("change").rstrip("."),
                              "description": f"`{s.get('name')}` in `{s.get('file')}`",
                              "blocked": False})

    # a crew task mirrors to whichever level carries the work
    unit = cfg["crewUnit"]
    if unit == "auto":
        unit = "task" if structure == "tasks" else "story"

    sprint = None if cfg["board"] == "kanban" else cfg["sprint"]
    for it in items:
        it["tags"] = list(cfg["tags"])
        if sprint and it["level"] == "story":
            it["sprint"] = sprint
    return items, unit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan", nargs="?")
    ap.add_argument("--config", default=str(DEFAULT_CONFIG))
    ap.add_argument("--init", action="store_true", help="write a starter config")
    ap.add_argument("--explain", action="store_true")
    a = ap.parse_args()

    if a.init:
        p = pathlib.Path(a.config)
        if p.exists():
            sys.exit(f"{p} already exists — left alone")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(STARTER, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {p} — set `project` and check the status names against your workflow")
        return
    if not a.plan:
        sys.exit("give a plan.json, or --init")

    cfg, errs = load_config(a.config)
    if errs:
        for e in errs:
            print("config: " + e, file=sys.stderr)
        sys.exit(1)
    plan, maps = load_maps(a.plan)
    structure, why = choose(cfg, maps)
    items, unit = build(plan, maps, cfg, structure)

    if a.explain:
        print(f"board:     {cfg['board']}" + (f" (sprint: {cfg['sprint']})" if cfg["board"] == "scrum" else ""))
        print(f"structure: {structure} — {why}")
        print(f"crew task mirrors to: {unit}")
        counts = {}
        for it in items:
            counts[it["level"]] = counts.get(it["level"], 0) + 1
        print("creates:   " + ", ".join(f"{v} {k}(s)" for k, v in counts.items()))
        return

    print(json.dumps({"project": cfg["project"], "board": cfg["board"],
                      "structure": structure, "why": why, "crewUnit": unit,
                      "items": items}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
