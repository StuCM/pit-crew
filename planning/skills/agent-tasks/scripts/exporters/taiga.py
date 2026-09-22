"""Taiga: a CSV for the user-story bulk importer, plus JSON for the API.

Taiga's importer expects at minimum a subject and a description, and accepts
tags and a reference. Column names differ between Taiga versions and between
self-hosted instances, so check these against your own before a bulk import —
this writes a documented, conventional set rather than guessing at yours.
"""
import csv
import json


def _description(t):
    L = []
    if t["goal"]:
        L += [t["goal"], ""]
    if t["why"]:
        L += ["Why: " + t["why"], ""]
    if t["files"]:
        L += ["Files:"] + [f"- {f}" for f in t["files"]] + [""]
    if t["steps"]:
        L += ["Approach:"] + [f"{i}. {s}" for i, s in enumerate(t["steps"], 1)] + [""]
    if t["out_of_scope"]:
        L += ["Out of scope:"] + [f"- {s}" for s in t["out_of_scope"]] + [""]
    if t["done"]:
        L += ["Done when:"] + [f"- {s}" for s in t["done"]] + [""]
    if t["blockers"]:
        L += ["Blocked by:"] + [f"- [{b['kind']}] {b['text']}" for b in t["blockers"]]
    return "\n".join(L).strip()


def write(tasks, outdir, meta):
    rows = []
    for t in tasks:
        rows.append({
            "ref": f"{t['n']:03d}",
            "subject": t["title"],
            "description": _description(t),
            "status": "Blocked" if t["blockers"] else "New",
            "tags": ",".join(["plan"] + ([t["status_in_map"]] if t.get("status_in_map") else [])),
            "is_blocked": "true" if t["blockers"] else "false",
            "blocked_note": "; ".join(b["text"] for b in t["blockers"]),
        })
    c = outdir / "taiga-user-stories.csv"
    with c.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["ref"])
        w.writeheader()
        w.writerows(rows)
    j = outdir / "taiga-user-stories.json"
    j.write_text(json.dumps({"project": meta["plan"], "user_stories": rows},
                            indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return [c, j]
