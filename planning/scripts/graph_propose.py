#!/usr/bin/env python3
"""Turn confirmed planning outcomes into proposed memory-graph nodes.

    python3 scripts/graph_propose.py plan.json
    python3 scripts/graph_propose.py plan.json --json
    python3 scripts/graph_propose.py plan.json --append .claude/tasks/007-thing.md

Proposals only. crew has one graph writer — the orchestrator — and writes go
through the MCP, so this prints a block for a human to review and commit. It
never touches the store.

What it will and will not propose, deliberately:

- **Decision** — only from `decisions[]` entries the user actually decided.
  Options and notes are conversation, not record.
- **Pattern** — rejected and deferred parts, with the reason. These are the
  traps: recorded once, they stop the same dead end being re-proposed. crew
  calls these the highest-value writes and they are the reason this exists.
- **Constraint** — `not` entries, which are boundaries a future agent should
  not quietly cross.
- Nothing from `proposed`, `open` or `unknown` parts. A graph full of guesses
  gives bad advice, which defeats the point of having one.
"""
import argparse
import json
import pathlib
import sys

LAYERS = ("brainstorm", "architecture", "feature")
TRAPPY = {"rejected", "deferred"}


def load(path):
    p = pathlib.Path(path)
    d = json.loads(p.read_text(encoding="utf-8"))
    if d.get("parts") or d.get("themes"):
        return {"name": d.get("title", "plan")}, [d]
    maps = []
    for layer in LAYERS:
        m = (d.get("maps") or {}).get(layer)
        if not m:
            continue
        f = p.parent / m["file"]
        if f.is_file():
            j = json.loads(f.read_text(encoding="utf-8"))
            j["_layer"] = layer
            maps.append(j)
    return d, maps


def trim(s, n=200):
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def collect(plan, maps):
    out = []
    seen = set()

    def add(node):
        key = (node["type"], node["name"].lower())
        if key not in seen:
            seen.add(key)
            out.append(node)

    for m in maps:
        title = m.get("title", "")
        by_id = {p["id"]: p for p in m.get("parts") or []}

        for d in m.get("decisions") or []:
            if d.get("kind") != "decided":
                continue                      # options and notes are not record
            label = d.get("part_label") or by_id.get(d.get("part"), {}).get("label", "")
            add({"type": "Decision",
                 "name": trim(f"{label}: {d.get('decided')}", 90),
                 "description": trim(d.get("decided", "")),
                 "rationale": trim(d.get("why", "")),
                 "affects": label,
                 "date": d.get("date"),
                 "source": f"{title} ({d.get('id')})"})

        for p in m.get("parts") or []:
            if p.get("status") in TRAPPY:
                why = p.get("why_split") or p.get("why_here") or ""
                if not why.strip():
                    continue
                verb = "Deferred" if p["status"] == "deferred" else "Ruled out"
                add({"type": "Pattern",
                     "name": trim(f"{verb}: {p.get('label')}", 90),
                     "description": trim(why, 320),
                     "affects": p.get("label"),
                     "source": title})
            if p.get("status") in ("agreed", "exists", "extend", "new"):
                for n in p.get("not") or []:
                    add({"type": "Constraint",
                         "name": trim(f"{p.get('label')} is not responsible for "
                                      + n.rstrip("."), 90),
                         "description": trim(n),
                         "affects": p.get("label"),
                         "source": title})

        # brainstorm maps carry the same traps at discussion level
        for t in m.get("themes") or []:
            stack = list(t.get("nodes") or [])
            while stack:
                n = stack.pop()
                stack.extend(n.get("children") or [])
                if n.get("status") == "rejected" and (n.get("rationale") or "").strip():
                    add({"type": "Pattern",
                         "name": trim(f"Ruled out: {n.get('label')}", 90),
                         "description": trim(n["rationale"], 320),
                         "affects": t.get("label", ""),
                         "source": title})
    return out


def markdown(nodes, plan):
    if not nodes:
        return "## Graph writes proposed\n\nNone — nothing in this plan is confirmed yet.\n"
    L = ["## Graph writes proposed", "",
         f"From the plan maps for **{plan.get('name', 'this plan')}**. "
         "Review before committing; the orchestrator is the only writer.", ""]
    for kind in ("Decision", "Pattern", "Constraint", "Preference"):
        rows = [n for n in nodes if n["type"] == kind]
        if not rows:
            continue
        L.append(f"### {kind}")
        for n in rows:
            L.append(f"- **{n['name']}**")
            if n.get("description"):
                L.append(f"  - description: {n['description']}")
            if n.get("rationale"):
                L.append(f"  - rationale: {n['rationale']}")
            if n.get("affects"):
                L.append(f"  - affects: {n['affects']}")
            L.append(f"  - source: {n.get('source', '')}")
        L.append("")
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--append", help="a crew task file; replaces its "
                                     "'Graph writes proposed' section")
    a = ap.parse_args()

    plan, maps = load(a.plan)
    if not maps:
        sys.exit("that plan points at no readable maps")
    nodes = collect(plan, maps)

    if a.json:
        print(json.dumps({"plan": plan.get("name"), "proposed": nodes},
                         indent=2, ensure_ascii=False))
        return

    block = markdown(nodes, plan)
    if a.append:
        p = pathlib.Path(a.append)
        text = p.read_text(encoding="utf-8")
        marker = "## Graph writes proposed"
        if marker in text:
            head = text[: text.index(marker)]
            p.write_text(head + block, encoding="utf-8")
        else:
            p.write_text(text.rstrip() + "\n\n" + block, encoding="utf-8")
        counts = {}
        for n in nodes:
            counts[n["type"]] = counts.get(n["type"], 0) + 1
        print(f"{p}: {', '.join(f'{v} {k}' for k, v in sorted(counts.items())) or 'nothing'}")
        return

    sys.stdout.write(block)


if __name__ == "__main__":
    main()
