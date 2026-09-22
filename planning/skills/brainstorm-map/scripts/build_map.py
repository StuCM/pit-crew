#!/usr/bin/env python3
"""Turn a brainstorm map JSON file into a standalone HTML page.

    python3 scripts/build_map.py map.json -o out.html

Validates the map first: every node needs a unique id, a short label, a known
status, and at least one piece of evidence. Nodes that fail validation are
reported and the build stops, because a map full of invented nodes is worse
than no map.
"""
import argparse
import json
import pathlib
import sys

STATUSES = {"decided", "explored", "rejected", "open", "corrected"}
TEMPLATE = pathlib.Path(__file__).resolve().parent.parent / "assets" / "template.html"


def validate(data):
    errs, warns, seen = [], [], set()

    def node(n, path):
        nid = n.get("id")
        if not nid:
            errs.append(f"{path}: missing id")
        elif nid in seen:
            errs.append(f"{path}: duplicate id {nid!r}")
        else:
            seen.add(nid)
        label = (n.get("label") or "").strip()
        if not label:
            errs.append(f"{path}: missing label")
        elif len(label.split()) > 5:
            warns.append(f"{path}: label is {len(label.split())} words — keep bubbles to 4 or fewer")
        status = n.get("status")
        if status not in STATUSES:
            errs.append(f"{path}: status {status!r} not one of {sorted(STATUSES)}")
        if not n.get("evidence"):
            errs.append(f"{path}: no evidence — every node must cite the chat")
        if status in ("rejected", "corrected") and not (n.get("rationale") or "").strip():
            errs.append(f"{path}: {status} nodes must say why")
        for i, c in enumerate(n.get("children") or []):
            node(c, f"{path} > {label or '?'}[{i}]")

    if not data.get("themes"):
        errs.append("map has no themes")
    for ti, t in enumerate(data.get("themes") or []):
        tid = t.get("id")
        if not tid:
            errs.append(f"themes[{ti}]: missing id")
        elif tid in seen:
            errs.append(f"themes[{ti}]: duplicate id {tid!r}")
        else:
            seen.add(tid)
        if not (t.get("label") or "").strip():
            errs.append(f"themes[{ti}]: missing label")
        if not t.get("nodes"):
            warns.append(f"themes[{ti}]: no nodes")
        for ni, n in enumerate(t.get("nodes") or []):
            node(n, f"themes[{ti}].nodes[{ni}]")
    return errs, warns


def build(data, template):
    title = data.get("title", "Brainstorm map")
    html = template.replace("__MAP_DATA__", json.dumps(data, ensure_ascii=False))
    return html.replace("__TITLE__", title.replace("<", "&lt;"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("map_json")
    ap.add_argument("-o", "--out", default="brainstorm-map.html")
    ap.add_argument("--template", default=str(TEMPLATE))
    ap.add_argument("--skip-validation", action="store_true")
    a = ap.parse_args()

    data = json.loads(pathlib.Path(a.map_json).read_text(encoding="utf-8"))
    errs, warns = validate(data)
    for w in warns:
        print("warn: " + w, file=sys.stderr)
    if errs and not a.skip_validation:
        for e in errs:
            print("error: " + e, file=sys.stderr)
        sys.exit(f"\n{len(errs)} problem(s) — fix the map JSON and rebuild.")

    out = pathlib.Path(a.out)
    out.write_text(build(data, pathlib.Path(a.template).read_text(encoding="utf-8")), encoding="utf-8")

    themes = len(data.get("themes") or [])
    count = 0

    def walk(ns):
        nonlocal count
        for n in ns:
            count += 1
            walk(n.get("children") or [])

    for t in data.get("themes") or []:
        walk(t.get("nodes") or [])
    print(f"{out}  —  {themes} sections, {count} nodes, {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
