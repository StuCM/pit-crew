#!/usr/bin/env python3
"""Work out what Taiga should show for a crew task, and whether anything needs
saying.

    python3 scripts/mirror_payload.py .claude/tasks/007-thing.md
    python3 scripts/mirror_payload.py .claude/tasks/007-thing.md --set-ref 412
    python3 scripts/mirror_payload.py .claude/tasks/007-thing.md --mark-synced

One way only. The task file is the truth; Taiga is a human-readable view of it.
Nothing here reads Taiga, and nothing in crew waits on it — if the push fails,
the loop carries on and the next status change catches up.

The comment policy is the point. Mirroring every event trains people to ignore
the card, so a comment is written only when a human has something to do:
dispatch, blocked, pending-<env>, and close. `review` moves the card and says
nothing.
"""
import argparse
import json
import pathlib
import re
import sys

# The six intrinsic crew statuses, plus pending-<env> derived from the config.
INTRINSIC = {
    "draft":    {"taiga": "New",         "comment": False, "waits": True},
    "approved": {"taiga": "Ready",       "comment": False, "waits": False},
    "building": {"taiga": "In progress", "comment": True,  "waits": False},
    "review":   {"taiga": "In progress", "comment": False, "waits": False},
    "blocked":  {"taiga": "In progress", "comment": True,  "waits": True, "blocked": True},
    "done":     {"taiga": "Done",        "comment": True,  "waits": False},
}


def parse(path):
    text = pathlib.Path(path).read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        sys.exit(f"{path}: no frontmatter — is this a crew task file?")
    fm, body = {}, m.group(2)
    key = None
    for line in m.group(1).splitlines():
        if re.match(r"^\s*-\s", line) and key:
            fm.setdefault(key, []).append(line.split("-", 1)[1].strip())
        elif ":" in line:
            key, _, val = line.partition(":")
            key, val = key.strip(), val.strip()
            fm[key] = val if val else []
    return fm, body, text


def section(body, name):
    m = re.search(rf"^## {re.escape(name)}\s*\n(.*?)(?=^## |\Z)", body, re.S | re.M)
    return m.group(1).strip() if m else ""


def pending_statuses(config_path):
    """pending-<env> exists for any environment no agent can reach."""
    out = {}
    p = pathlib.Path(config_path)
    if not p.is_file():
        return out
    try:
        cfg = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return out
    for name, env in (cfg.get("environments") or {}).items():
        if env.get("reachableFromAgents") is False:
            out[f"pending-{name}"] = {
                "taiga": "Ready for test", "comment": True, "waits": True,
                "note": env.get("note") or f"code-complete; only {name} can prove it"}
    return out


def comment_for(status, fm, body, meta):
    if status == "building":
        return (f"Dispatched to its own session.\n\n"
                f"- branch: `{fm.get('branch', '?')}`\n"
                f"- model: `{fm.get('model', '?')}`\n"
                f"- env: `{fm.get('env', '?')}`\n"
                f"- files: {', '.join(f'`{f}`' for f in fm.get('files', [])) or '—'}")
    if status == "blocked":
        rounds = section(body, "Review rounds")
        tail = rounds.strip().splitlines()[-6:] if rounds.strip() else []
        return ("Blocked: the review rounds disagreed and it needs a human call.\n\n"
                + ("\n".join(tail) if tail else "See the task file's review rounds."))
    if status.startswith("pending-"):
        return (f"Code-complete, unproven.\n\n{meta.get('note', '')}\n\n"
                f"Nothing in the loop can clear this — it needs checking on "
                f"`{status.split('-', 1)[1]}`.")
    if status == "done":
        dod = section(body, "Definition of done")
        return ("Done — the gate and the review passed.\n\n"
                + (dod if dod else "") + f"\n\nRounds: {fm.get('rounds', '?')}")
    return ""


def taiga_config(path):
    """Status names, which moments get comments, and which attributes to set,
    from .claude/taiga.json. Anything missing keeps the built-in default."""
    p = pathlib.Path(path)
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("task")
    ap.add_argument("--config", default=".claude/crew.config.json")
    ap.add_argument("--taiga-config", default=".claude/taiga.json")
    ap.add_argument("--set-ref", help="record the Taiga story reference in the task file")
    ap.add_argument("--mark-synced", action="store_true",
                    help="record the pushed status, so the next run knows what changed")
    a = ap.parse_args()

    path = pathlib.Path(a.task)
    fm, body, raw = parse(path)

    if a.set_ref or a.mark_synced:
        out = raw
        for key, val in (("taiga", a.set_ref), ("taigaSynced", fm.get("status"))):
            if key == "taiga" and not a.set_ref:
                continue
            if key == "taigaSynced" and not a.mark_synced:
                continue
            if re.search(rf"^{key}:.*$", out, re.M):
                out = re.sub(rf"^{key}:.*$", f"{key}: {val}", out, count=1, flags=re.M)
            else:
                out = re.sub(r"^(rounds:.*)$", rf"\1\n{key}: {val}", out, count=1, flags=re.M)
        path.write_text(out, encoding="utf-8")
        print(f"{path}: " + ", ".join(
            x for x in [f"taiga: {a.set_ref}" if a.set_ref else None,
                        f"taigaSynced: {fm.get('status')}" if a.mark_synced else None] if x))
        return

    status = fm.get("status", "draft")
    table = {k: dict(v) for k, v in {**INTRINSIC, **pending_statuses(a.config)}.items()}
    tc = taiga_config(a.taiga_config)
    names = tc.get("statuses") or {}
    wanted = set(tc.get("comments") or ["building", "blocked", "pending", "done"])
    for k, v in table.items():
        base = "pending" if k.startswith("pending-") else k
        if base in names:
            v["taiga"] = names[base]
        v["comment"] = v["comment"] and base in wanted
    meta = table.get(status)
    if not meta:
        sys.exit(f"unknown status {status!r} — not one of {', '.join(sorted(table))}")

    changed = fm.get("taigaSynced") != status
    payload = {
        "ref": fm.get("taiga"),
        "task": f"{fm.get('id')}-{fm.get('slug')}",
        "subject": re.search(r"^# (.+)$", body, re.M).group(1) if re.search(r"^# ", body, re.M)
                   else fm.get("slug", ""),
        "crew_status": status,
        "taiga_status": meta["taiga"],
        "is_blocked": bool(meta.get("blocked")),
        "blocked_note": "review rounds disagreed" if meta.get("blocked") else "",
        "waits_on_user": bool(meta.get("waits")),
        "attributes": {k: fm.get(k, "") for k in
                       (tc.get("attributes") or ["branch", "env", "model", "rounds"])},
        "level": tc.get("crewUnit", "auto"),
        "changed_since_last_push": changed,
        "comment": comment_for(status, fm, body, meta) if (changed and meta["comment"]) else None,
    }
    if not payload["ref"]:
        payload["action"] = "create"
    else:
        payload["action"] = "update" if changed else "none"
    print(json.dumps(payload, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
