#!/usr/bin/env python3
"""Turn an architecture map JSON file into a standalone HTML page.

    python3 scripts/build_arch.py arch.json -o out.html

Validation is stricter than the diagram needs, on purpose. The failure mode of
this layer is a confident box nobody can define, so a part without a purpose,
or a connection nobody can justify, stops the build.
"""
import argparse
import json
import pathlib
import sys

STATUSES = {"agreed", "proposed", "open", "deferred", "rejected"}
# deferred = parked, revisit if X happens. rejected = ruled out, kept for the reason.
KINDS = {"ui", "service", "job", "store", "external", "data"}
EDGE_KINDS = {"data", "depends", "control", "event"}
TEMPLATE = pathlib.Path(__file__).resolve().parent.parent / "assets" / "template.html"


def validate(d):
    errs, warns = [], []
    ids, gids = set(), {g.get("id") for g in d.get("groups") or []}

    parts = d.get("parts") or []
    if not parts:
        errs.append("map has no parts")

    for i, p in enumerate(parts):
        where = f"parts[{i}] ({p.get('label') or p.get('id') or '?'})"
        pid = p.get("id")
        if not pid:
            errs.append(f"{where}: missing id")
        elif pid in ids:
            errs.append(f"{where}: duplicate id {pid!r}")
        else:
            ids.add(pid)

        label = (p.get("label") or "").strip()
        if not label:
            errs.append(f"{where}: missing label")
        elif len(label.split()) > 4:
            warns.append(f"{where}: label is {len(label.split())} words — boxes read better at 3 or fewer")

        if p.get("status") not in STATUSES:
            errs.append(f"{where}: status {p.get('status')!r} not one of {sorted(STATUSES)}")
        if p.get("kind") not in KINDS:
            errs.append(f"{where}: kind {p.get('kind')!r} not one of {sorted(KINDS)}")
        if not (p.get("purpose") or "").strip():
            errs.append(f"{where}: no purpose — if you cannot say what it does, it is not a part yet")
        if not (p.get("why_split") or "").strip():
            errs.append(f"{where}: no why_split — say why this is its own part rather than folded into a neighbour")
        if p.get("group") and p["group"] not in gids:
            errs.append(f"{where}: group {p['group']!r} is not defined")
        if p.get("status") in ("rejected", "deferred") and not (p.get("why_split") or "").strip():
            errs.append(f"{where}: {p.get('status')} parts must record why")
        if not p.get("evidence") and not p.get("traces"):
            errs.append(f"{where}: no evidence and no trace — every part must come from somewhere")

    seen_edge = set()
    for i, e in enumerate(d.get("edges") or []):
        eid = e.get("id") or f"e{i}"
        where = f"edges[{i}] ({eid})"
        if eid in seen_edge:
            errs.append(f"{where}: duplicate edge id")
        seen_edge.add(eid)
        for end in ("from", "to"):
            if e.get(end) not in ids:
                errs.append(f"{where}: {end} {e.get(end)!r} is not a part id")
        if e.get("kind") not in EDGE_KINDS:
            errs.append(f"{where}: kind {e.get('kind')!r} not one of {sorted(EDGE_KINDS)}")
        if e.get("from") == e.get("to"):
            warns.append(f"{where}: connects a part to itself")
        if not (e.get("label") or "").strip() and not (e.get("note") or "").strip():
            warns.append(f"{where}: unlabelled — an arrow nobody can name usually means the boundary is wrong")

    orphans = [p["label"] for p in parts
               if p.get("id") and p.get("status") not in ("rejected", "deferred")
               and not any(e.get("from") == p["id"] or e.get("to") == p["id"] for e in d.get("edges") or [])]
    for o in orphans:
        warns.append(f"part {o!r} has no connections — either it is missing edges or it does not belong here")

    return errs, warns


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("map_json")
    ap.add_argument("-o", "--out", default="architecture-map.html")
    ap.add_argument("--template", default=str(TEMPLATE))
    ap.add_argument("--skip-validation", action="store_true")
    a = ap.parse_args()

    d = json.loads(pathlib.Path(a.map_json).read_text(encoding="utf-8"))
    errs, warns = validate(d)
    for w in warns:
        print("warn: " + w, file=sys.stderr)
    if errs and not a.skip_validation:
        for e in errs:
            print("error: " + e, file=sys.stderr)
        sys.exit(f"\n{len(errs)} problem(s) — fix the map JSON and rebuild.")

    tpl = pathlib.Path(a.template).read_text(encoding="utf-8")
    title = d.get("title", "Architecture map")
    html = tpl.replace("__MAP_DATA__", json.dumps(d, ensure_ascii=False)).replace("__TITLE__", title.replace("<", "&lt;"))
    out = pathlib.Path(a.out)
    out.write_text(html, encoding="utf-8")

    opens = sum(len(p.get("open") or []) for p in d.get("parts") or [])
    print(f"{out}  —  {len(d.get('parts') or [])} parts, {len(d.get('edges') or [])} connections, "
          f"{opens} unresolved, {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
