#!/usr/bin/env python3
"""Collect every unresolved thread across a set of plan maps and order them by
leverage — how much else is waiting on the answer.

    python3 scripts/rank_threads.py brainstorm.json arch.json feature.json
    python3 scripts/rank_threads.py *.json --json          # machine-readable
    python3 scripts/rank_threads.py arch.json --top 5

Reads brainstorm maps (themes/nodes), architecture maps and feature maps
(parts/edges) — the shape is sniffed, so mixing them in one call is the point.

Ordering is computed from the maps, not from what seems interesting: a thread
scores on how many parts sit downstream of it, how connected it is, how many
other open questions name it, and how many things trace to it. Every score
prints its own reasoning so you can disagree with the order rather than take it
on trust.
"""
import argparse
import json
import pathlib
import re
import sys

STATUS_WEIGHT = {"unknown": 4, "open": 3, "corrected": 1, "proposed": 1, "explored": 1}


def expand(paths):
    """A plan manifest stands in for the maps it points at."""
    out = []
    for p in paths:
        try:
            d = json.loads(pathlib.Path(p).read_text(encoding="utf-8"))
        except Exception:
            out.append(p); continue
        if isinstance(d, dict) and d.get("maps") and not d.get("parts") and not d.get("themes"):
            base = pathlib.Path(p).parent
            for layer in ("brainstorm", "architecture", "feature"):
                m = d["maps"].get(layer)
                if m and (base / m["file"]).is_file():
                    out.append(str((base / m["file"]).resolve()))
        else:
            out.append(p)
    return out


def load(paths):
    maps = []
    for p in expand(paths):
        path = pathlib.Path(p)
        d = json.loads(path.read_text(encoding="utf-8"))
        d["_file"] = str(path)
        d["_kind"] = "brainstorm" if d.get("themes") else "plan"
        maps.append(d)
    return maps


def walk_nodes(theme):
    for n in theme.get("nodes") or []:
        yield from _walk(n)


def _walk(n):
    yield n
    for c in n.get("children") or []:
        yield from _walk(c)


def collect(maps):
    """Every unresolved thing, flattened into comparable threads."""
    threads = []
    for m in maps:
        title = m.get("title") or m.get("id") or m["_file"]
        if m["_kind"] == "brainstorm":
            for t in m.get("themes") or []:
                for n in walk_nodes(t):
                    if n.get("status") in ("open", "corrected"):
                        threads.append(dict(
                            map=title, file=m["_file"], owner=n["id"], owner_label=n.get("label", ""),
                            question=n.get("claim") or n.get("rationale") or n.get("label", ""),
                            kind="discussion", status=n.get("status"),
                            section=t.get("label", "")))
        else:
            for p in m.get("parts") or []:
                for q in p.get("open") or []:
                    threads.append(dict(
                        map=title, file=m["_file"], owner=p["id"], owner_label=p.get("label", ""),
                        question=q, kind="question", status=p.get("status"),
                        section=(p.get("group") or "")))
                if p.get("status") in ("open", "unknown") and not (p.get("open") or []):
                    threads.append(dict(
                        map=title, file=m["_file"], owner=p["id"], owner_label=p.get("label", ""),
                        question=f"What is {p.get('label')} actually? Its status is {p.get('status')} "
                                 f"and nothing says what would settle it.",
                        kind="undefined", status=p.get("status"), section=(p.get("group") or "")))
                unver = [s for s in (p.get("surface") or []) if not s.get("verified")
                         and s.get("use") != "add"]
                if unver:
                    names = ", ".join(s.get("name", "?") for s in unver[:4])
                    threads.append(dict(
                        map=title, file=m["_file"], owner=p["id"], owner_label=p.get("label", ""),
                        question=f"{len(unver)} symbol(s) on {p.get('label')} are unverified ({names}). "
                                 f"Confirm against the repo before anything is built on them.",
                        kind="unverified", status=p.get("status"), section=(p.get("group") or ""),
                        count=len(unver)))
    return threads


def downstream(part_id, edges, seen=None):
    seen = seen or set()
    for e in edges:
        if e.get("from") == part_id and e.get("to") not in seen:
            seen.add(e["to"])
            downstream(e["to"], edges, seen)
    return seen


def group(threads):
    """One thread per part, not per question. Leverage is a property of the
    part, so listing its questions separately just repeats the same score and
    turns a conversation into a queue."""
    out = {}
    for t in threads:
        key = (t["file"], t["owner"])
        g = out.get(key)
        if not g:
            g = {k: t[k] for k in ("map", "file", "owner", "owner_label", "status", "section")}
            g["questions"] = []
            g["kinds"] = set()
            g["count"] = 0
            out[key] = g
        g["questions"].append(t["question"])
        g["kinds"].add(t["kind"])
        g["count"] += t.get("count", 0)
    for g in out.values():
        g["kinds"] = sorted(g["kinds"])
    return list(out.values())


def score(threads, maps):
    edges_by_file = {m["_file"]: (m.get("edges") or []) for m in maps}
    labels = {}
    for m in maps:
        for p in m.get("parts") or []:
            labels[p["id"]] = p.get("label", "")
    # everything that traces into a given id, across every map supplied
    traced = {}
    for m in maps:
        for p in m.get("parts") or []:
            for t in p.get("traces") or []:
                traced[t.get("id")] = traced.get(t.get("id"), 0) + 1

    all_questions = [q.lower() for t in threads for q in t["questions"]]

    for t in threads:
        edges = edges_by_file.get(t["file"], [])
        blocks = len(downstream(t["owner"], edges)) if edges else 0
        touches = sum(1 for e in edges if t["owner"] in (e.get("from"), e.get("to")))
        lab = (t["owner_label"] or "").lower()
        mine = {q.lower() for q in t["questions"]}
        named = sum(1 for q in all_questions
                    if lab and len(lab) > 3 and lab in q and q not in mine)
        tr = traced.get(t["owner"], 0)
        unver = t.get("count", 0)
        sw = STATUS_WEIGHT.get(t.get("status"), 1)

        t["score"] = 3*blocks + 2*touches + 2*named + 2*tr + unver + sw + len(t["questions"])
        why = []
        if blocks:
            why.append(f"{blocks} part(s) downstream")
        if touches:
            why.append(f"{touches} connection(s)")
        if named:
            why.append(f"named in {named} other open question(s)")
        if tr:
            why.append(f"{tr} trace(s) point at it")
        if unver:
            why.append(f"{unver} unverified symbol(s)")
        if t.get("status") in ("unknown", "open"):
            why.append(f"status {t['status']}")
        if len(t["questions"]) > 1:
            why.append(f"{len(t['questions'])} questions on it")
        t["why"] = "; ".join(why) or "no dependants found — cheap to settle or safe to drop"
    threads.sort(key=lambda x: (-x["score"], x["map"], x["owner"]))
    return threads


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("maps", nargs="+", help="map files, or a plan.json manifest")
    ap.add_argument("--top", type=int, default=0, help="only show the first N")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    maps = load(a.maps)
    threads = score(group(collect(maps)), maps)
    if a.top:
        threads = threads[:a.top]

    if a.json:
        print(json.dumps(threads, indent=2, ensure_ascii=False))
        return

    if not threads:
        print("Nothing unresolved across these maps.")
        return

    qs = sum(len(t["questions"]) for t in threads)
    print(f"{len(threads)} open thread(s) holding {qs} question(s), highest leverage first\n")
    for i, t in enumerate(threads, 1):
        print(f"{i}. [{t['score']:>3}] {t['owner_label']}  ({t['map']} · {'/'.join(t['kinds'])})")
        print(f"     why here: {t['why']}")
        for q in t["questions"]:
            print(f"       - {q}")
        print(f"     write back: --map {t['file']} --part {t['owner']}\n")


if __name__ == "__main__":
    main()
