#!/usr/bin/env python3
"""Write the outcome of a session back into a plan map.

    # a decision the user made
    python3 scripts/resolve.py --map arch.json --part p-digobj \
        --question "standard Arches reference data model" \
        --decided "Customised graph; Digital Object carries a derivative list and a status field." \
        --why "The widget reads the derivative list to choose a renderer, so it has to be first-class." \
        --status agreed

    # no decision yet, but the conversation produced real options
    python3 scripts/resolve.py --map arch.json --part p-filestore \
        --question "S3-compatible blob storage" \
        --options "Azure Blob with range requests|Django FileResponse with byte-range handling|CDN in front of either" \
        --why "Ruled out serving through Django without range support: the Nexus loader needs it."

    # just record what was discussed, changing nothing
    python3 scripts/resolve.py --map arch.json --part p-queue --note "Ran through failure modes; no decision."

Every write appends to a `decisions` list on the map, so the history of how a
question was settled survives the question disappearing from the diagram.
Nothing is ever silently overwritten and `--dry-run` shows the change first.
"""
import argparse
import datetime
import json
import pathlib
import sys

PLAN_STATUSES = {"agreed", "proposed", "open", "rejected",
                 "exists", "extend", "new", "unknown"}


def find_part(d, pid):
    for p in d.get("parts") or []:
        if p.get("id") == pid:
            return p
    for t in d.get("themes") or []:
        stack = list(t.get("nodes") or [])
        while stack:
            n = stack.pop()
            if n.get("id") == pid:
                return n
            stack.extend(n.get("children") or [])
    sys.exit(f"no part or node with id {pid!r} in this map")


def match_question(part, needle):
    """Match one open question by substring. Ambiguity is an error, not a guess."""
    opens = part.get("open") or []
    hits = [q for q in opens if needle.lower() in q.lower()]
    if not hits:
        sys.exit(f"no open question on {part.get('id')} contains {needle!r}\n"
                 + "\n".join("  - " + q for q in opens))
    if len(hits) > 1:
        sys.exit(f"{needle!r} matches {len(hits)} open questions — be more specific:\n"
                 + "\n".join("  - " + q for q in hits))
    return hits[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", required=True)
    ap.add_argument("--part", required=True)
    ap.add_argument("--question", help="substring of the open question this concerns")
    ap.add_argument("--decided", help="what was settled — only use when the user decided")
    ap.add_argument("--options", help="pipe-separated options, when nothing was settled")
    ap.add_argument("--why", help="the reasoning that got there")
    ap.add_argument("--note", help="record the discussion without resolving anything")
    ap.add_argument("--status", help=f"new status for the part {sorted(PLAN_STATUSES)}")
    ap.add_argument("--keep-open", action="store_true",
                    help="record the decision but leave the question on the map")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if a.decided and a.options:
        sys.exit("--decided and --options are mutually exclusive: either it was settled or it was not")
    if not any([a.decided, a.options, a.note, a.status]):
        sys.exit("nothing to write — give --decided, --options, --note or --status")
    if a.status and a.status not in PLAN_STATUSES:
        sys.exit(f"--status {a.status!r} not one of {sorted(PLAN_STATUSES)}")

    path = pathlib.Path(a.map)
    d = json.loads(path.read_text(encoding="utf-8"))
    part = find_part(d, a.part)

    question = match_question(part, a.question) if a.question else None
    changes = []

    record = {
        "id": f"d{len(d.get('decisions') or []) + 1}",
        "part": a.part,
        "part_label": part.get("label", ""),
        "date": datetime.date.today().isoformat(),
        "source": "session",
    }
    if question:
        record["question"] = question
    if a.decided:
        record["kind"] = "decided"
        record["decided"] = a.decided
    elif a.options:
        record["kind"] = "options"
        record["options"] = [o.strip() for o in a.options.split("|") if o.strip()]
    else:
        record["kind"] = "note"
    if a.why:
        record["why"] = a.why
    if a.note:
        record["note"] = a.note

    # the question only leaves the map when something was actually decided
    if question and a.decided and not a.keep_open:
        part["open"] = [q for q in part["open"] if q != question]
        if not part["open"]:
            part.pop("open")
        changes.append(f"closed open question on {a.part}: {question[:70]}")
    elif question and a.options:
        changes.append(f"left open (options recorded) on {a.part}: {question[:70]}")

    if a.status and part.get("status") != a.status:
        changes.append(f"status {part.get('status')!r} -> {a.status!r} on {a.part}")
        part["status"] = a.status

    d.setdefault("decisions", []).append(record)
    changes.append(f"appended decision {record['id']} ({record['kind']})")

    if a.dry_run:
        print("would write:")
        for c in changes:
            print("  - " + c)
        print(json.dumps(record, indent=2, ensure_ascii=False))
        return

    path.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for c in changes:
        print("  - " + c)
    left = sum(len(p.get("open") or []) for p in d.get("parts") or [])
    print(f"{path}: {left} open question(s) remaining")


if __name__ == "__main__":
    main()
