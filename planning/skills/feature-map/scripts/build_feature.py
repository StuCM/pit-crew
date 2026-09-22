#!/usr/bin/env python3
"""Turn a feature map JSON file into a standalone HTML page, verifying every
symbol against the repository first.

    python3 scripts/build_feature.py feature.json --repo /path/to/repo -o out.html

Verification is the point of this skill. For each entry in a part's `surface`,
the script opens the file and checks the symbol name actually appears there —
at the recorded line if one is given, anywhere in the file otherwise. Entries
that check out are marked verified; everything else is marked unverified and
rendered with a warning badge.

Without --repo nothing can be checked, so every symbol is marked unverified.
That is a usable state: the map becomes a list of things to go and confirm.
"""
import argparse
import json
import pathlib
import re
import sys

STATUSES = {"exists", "extend", "new", "unknown"}
KINDS = {"ui", "service", "job", "store", "external", "data"}
EDGE_KINDS = {"data", "depends", "control", "event"}
USES = {"call", "read", "subclass", "modify", "replace", "add"}
CHANGING = {"modify", "replace", "add"}   # these write code; the rest only consume it
LEGACY = {"extend": "modify", "override": "modify"}
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
        if not (p.get("label") or "").strip():
            errs.append(f"{where}: missing label")
        if p.get("status") not in STATUSES:
            errs.append(f"{where}: status {p.get('status')!r} not one of {sorted(STATUSES)}")
        if p.get("kind") not in KINDS:
            errs.append(f"{where}: kind {p.get('kind')!r} not one of {sorted(KINDS)}")
        if not (p.get("purpose") or "").strip():
            errs.append(f"{where}: no purpose")
        if not (p.get("why_here") or "").strip():
            errs.append(f"{where}: no why_here — say why this part is on the map at all "
                        f"(we call it, it calls us, or its contract constrains us)")
        if p.get("group") and p["group"] not in gids:
            errs.append(f"{where}: group {p['group']!r} is not defined")

        existing = p.get("status") in ("exists", "extend")
        if existing and not (p.get("where") or []):
            errs.append(f"{where}: an existing part must say where it lives (paths)")
        if p.get("status") == "extend" and not (p.get("surface") or []):
            warns.append(f"{where}: marked extend but names no symbols — what exactly changes?")

        for j, sym in enumerate(p.get("surface") or []):
            sw = f"{where}.surface[{j}] ({sym.get('name') or '?'})"
            if not (sym.get("name") or "").strip():
                errs.append(f"{sw}: missing name")
            use = LEGACY.get(sym.get("use"), sym.get("use"))
            if use != sym.get("use"):
                sym["use"] = use
            if use not in USES:
                errs.append(f"{sw}: use {sym.get('use')!r} not one of {sorted(USES)} "
                            f"({', '.join(sorted(CHANGING))} write code; the rest only consume it)")
            if use in CHANGING and not (sym.get("change") or "").strip():
                errs.append(f"{sw}: use {use!r} changes code, so it must say what changes "
                            f"— set \"change\" to a short description of the edit")
            if use not in CHANGING and (sym.get("change") or "").strip():
                warns.append(f"{sw}: has a change note but use {use!r} only consumes the symbol")
            if use != "add" and not (sym.get("file") or "").strip():
                errs.append(f"{sw}: no file — a symbol you cannot locate is a guess, not a surface")

    seen = set()
    for i, e in enumerate(d.get("edges") or []):
        eid = e.get("id") or f"e{i}"
        w = f"edges[{i}] ({eid})"
        if eid in seen:
            errs.append(f"{w}: duplicate edge id")
        seen.add(eid)
        for end in ("from", "to"):
            if e.get(end) not in ids:
                errs.append(f"{w}: {end} {e.get(end)!r} is not a part id")
        if e.get("kind") not in EDGE_KINDS:
            errs.append(f"{w}: kind {e.get('kind')!r} not one of {sorted(EDGE_KINDS)}")
        if not (e.get("label") or "").strip() and not (e.get("note") or "").strip():
            warns.append(f"{w}: unlabelled")
    return errs, warns


def verify(d, repo):
    """Mark each surface entry verified only if the symbol is really there."""
    checked = found = 0
    notes = []
    for p in d.get("parts") or []:
        for sym in p.get("surface") or []:
            if sym.get("use") == "add":
                sym["verified"] = False          # nothing to verify: it does not exist yet
                continue
            checked += 1
            sym["verified"] = False
            if not repo:
                continue
            f = (sym.get("file") or "").lstrip("/")
            path = repo / f
            if not path.is_file():
                notes.append(f"{sym.get('name')}: no such file {f}")
                continue
            try:
                lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError as exc:
                notes.append(f"{sym.get('name')}: {exc}")
                continue
            name = sym["name"].split("(")[0].split(".")[-1].strip()
            pat = re.compile(r"\b" + re.escape(name) + r"\b")
            ln = sym.get("line")
            if isinstance(ln, int) and 1 <= ln <= len(lines):
                window = lines[max(0, ln - 4): ln + 3]
                if any(pat.search(x) for x in window):
                    sym["verified"] = True
                    found += 1
                    continue
                notes.append(f"{sym['name']}: not found near {f}:{ln}")
            hit = next((i + 1 for i, x in enumerate(lines) if pat.search(x)), None)
            if hit:
                sym["verified"] = True
                sym["line"] = hit                # correct a stale line number
                found += 1
            else:
                notes.append(f"{sym['name']}: not found in {f}")
    return checked, found, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("map_json")
    ap.add_argument("--repo", help="path to the repository the map describes")
    ap.add_argument("-o", "--out", default="feature-map.html")
    ap.add_argument("--template", default=str(TEMPLATE))
    ap.add_argument("--skip-validation", action="store_true")
    ap.add_argument("--write-back", action="store_true",
                    help="persist the verified flags into the map JSON, so later tools "
                         "(agent-tasks, open-threads) can see what was actually checked")
    a = ap.parse_args()

    d = json.loads(pathlib.Path(a.map_json).read_text(encoding="utf-8"))
    errs, warns = validate(d)
    for w in warns:
        print("warn: " + w, file=sys.stderr)
    if errs and not a.skip_validation:
        for e in errs:
            print("error: " + e, file=sys.stderr)
        sys.exit(f"\n{len(errs)} problem(s) — fix the map JSON and rebuild.")

    repo = pathlib.Path(a.repo).resolve() if a.repo else None
    if a.repo and not repo.is_dir():
        sys.exit(f"--repo {a.repo} is not a directory")
    checked, found, notes = verify(d, repo)
    for n in notes:
        print("unverified: " + n, file=sys.stderr)
    if not repo:
        print("warn: no --repo given, so nothing was checked against real code", file=sys.stderr)

    if a.write_back:
        pathlib.Path(a.map_json).write_text(
            json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"verification written back to {a.map_json}", file=sys.stderr)

    tpl = pathlib.Path(a.template).read_text(encoding="utf-8")
    title = d.get("title", "Feature map")
    html = tpl.replace("__MAP_DATA__", json.dumps(d, ensure_ascii=False)).replace("__TITLE__", title.replace("<", "&lt;"))
    out = pathlib.Path(a.out)
    out.write_text(html, encoding="utf-8")

    parts = d.get("parts") or []
    counts = {s: sum(1 for p in parts if p.get("status") == s) for s in STATUSES}
    print(f"{out}  —  {len(parts)} parts ({counts['exists']} exist, {counts['extend']} changed, "
          f"{counts['new']} new, {counts['unknown']} unknown), "
          f"{found}/{checked} symbols verified, {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
