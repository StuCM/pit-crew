"""Plain markdown lists — the format an LLM reads with least ceremony."""


def _task(t):
    L = [f"## {t['n']:03d} — {t['title']}", ""]
    if t["goal"]:
        L += ["**Goal.** " + t["goal"], ""]
    if t["why"]:
        L += ["**Why.** " + t["why"], ""]
    if t["files"]:
        L += ["**Files**"] + [f"- `{f}`" for f in t["files"]] + [""]
    if t["steps"]:
        L += ["**Approach**"] + [f"{i}. {s}" for i, s in enumerate(t["steps"], 1)] + [""]
    if t["out_of_scope"]:
        L += ["**Out of scope**"] + [f"- {s}" for s in t["out_of_scope"]] + [""]
    if t["done"]:
        L += ["**Done when**"] + [f"- [ ] {s}" for s in t["done"]] + [""]
    if t["blockers"]:
        L += ["**Blocked by**"] + [f"- [{b['kind']}] {b['text']}" for b in t["blockers"]] + [""]
    if t["traces"]:
        tr = ", ".join(x.get("label", x.get("id", "")) for x in t["traces"])
        L += [f"**From.** {tr}" + (f" — {t['artifact']}" if t.get("artifact") else ""), ""]
    return L


def write(tasks, outdir, meta):
    lines = [f"# {meta['plan']} — tasks", "",
             f"{len(tasks)} task(s), in dependency order. "
             "Each is scoped to one session.", ""]
    lines += ["| # | task | files | blocked |", "|---|---|---|---|"]
    for t in tasks:
        lines.append(f"| {t['n']:03d} | {t['title']} | {len(t['files'])} | "
                     f"{len(t['blockers']) or ''} |")
    lines.append("")
    if meta.get("blocked"):
        lines += ["## Held back", "",
                  "Not written as tasks — unresolved questions or unverified symbols.", ""]
        for t in meta["blocked"]:
            lines.append(f"- **{t['title']}**")
            for b in t["blockers"]:
                lines.append(f"  - [{b['kind']}] {b['text']}")
        lines.append("")
    for t in tasks:
        lines += _task(t)
    p = outdir / "tasks.md"
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return [p]
