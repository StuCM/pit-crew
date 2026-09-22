#!/usr/bin/env python3
"""A plan manifest ties one project's maps together so tools take a project,
not a list of files.

    python3 scripts/plan.py init --name "Arches 3D viewer" \
        --brainstorm maps/brainstorm.json --architecture maps/arch.json \
        --feature maps/feature.json -o plan.json

    python3 scripts/plan.py show plan.json
    python3 scripts/plan.py artifact plan.json --architecture https://claude.ai/artifact/...

`plan.json` holds paths and, once published, the artifact links each map lives
at — which is what lets a later session read comments back without being told
where anything is.
"""
import argparse
import json
import pathlib
import sys

LAYERS = ("brainstorm", "architecture", "feature")


def load(path):
    p = pathlib.Path(path)
    if not p.is_file():
        sys.exit(f"no plan at {path}")
    return p, json.loads(p.read_text(encoding="utf-8"))


def resolve(plan_path, rel):
    return (pathlib.Path(plan_path).parent / rel).resolve()


def cmd_init(a):
    # paths are stored relative to the plan file, so the plan can be moved with its maps
    base = pathlib.Path(a.out).resolve().parent
    plan = {"name": a.name, "maps": {}}
    for layer in LAYERS:
        v = getattr(a, layer, None)
        if not v:
            continue
        src = pathlib.Path(v).resolve()
        if not src.is_file():
            sys.exit(f"--{layer} {v} does not exist")
        try:
            rel = src.relative_to(base).as_posix()
        except ValueError:
            rel = str(src)
        plan["maps"][layer] = {"file": rel}
    if not plan["maps"]:
        sys.exit("give at least one of --brainstorm --architecture --feature")
    out = pathlib.Path(a.out)
    out.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{out}: {', '.join(plan['maps'])}")


def cmd_artifact(a):
    path, plan = load(a.plan)
    n = 0
    for layer in LAYERS:
        url = getattr(a, layer, None)
        if not url:
            continue
        if layer not in plan.get("maps", {}):
            sys.exit(f"this plan has no {layer} map")
        plan["maps"][layer]["artifact"] = url
        n += 1
    if not n:
        sys.exit("give at least one --brainstorm/--architecture/--feature URL")
    path.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{path}: {n} artifact link(s) recorded")


def cmd_show(a):
    path, plan = load(a.plan)
    print(plan.get("name", "(unnamed plan)"))
    for layer in LAYERS:
        m = plan.get("maps", {}).get(layer)
        if not m:
            print(f"  {layer:<13} —")
            continue
        f = resolve(path, m["file"])
        state = "ok" if f.is_file() else "MISSING"
        print(f"  {layer:<13} {m['file']}  [{state}]")
        if m.get("artifact"):
            print(f"  {'':<13} {m['artifact']}")


def files_of(plan_path):
    """Used by rank_threads: every map file this plan points at, in layer order."""
    path, plan = load(plan_path)
    out = []
    for layer in LAYERS:
        m = plan.get("maps", {}).get(layer)
        if m:
            f = resolve(path, m["file"])
            if f.is_file():
                out.append(str(f))
    return out


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    i = sub.add_parser("init")
    i.add_argument("--name", required=True)
    for layer in LAYERS:
        i.add_argument("--" + layer)
    i.add_argument("-o", "--out", default="plan.json")
    i.set_defaults(fn=cmd_init)

    s = sub.add_parser("show")
    s.add_argument("plan")
    s.set_defaults(fn=cmd_show)

    t = sub.add_parser("artifact")
    t.add_argument("plan")
    for layer in LAYERS:
        t.add_argument("--" + layer)
    t.set_defaults(fn=cmd_artifact)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
