#!/usr/bin/env python3
"""Scaffold the planning layer in a project. Idempotent; never overwrites.

    python3 scripts/init_plan.py --name my-project
    python3 scripts/init_plan.py --name my-project --plans-dir .claude/plans
"""
import argparse
import json
import pathlib
import sys

CONFIG = pathlib.Path(".claude/crew.config.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--plans-dir", default=".claude/plans")
    a = ap.parse_args()

    plans = pathlib.Path(a.plans_dir)
    plans.mkdir(parents=True, exist_ok=True)
    (plans / "maps").mkdir(exist_ok=True)

    manifest = plans / "plan.json"
    if manifest.is_file():
        print(f"{manifest} already exists — left alone")
    else:
        manifest.write_text(json.dumps({"name": a.name, "maps": {}}, indent=2) + "\n",
                            encoding="utf-8")
        print(f"created {manifest}")
    print(f"created {plans}/maps/ for the map JSON")

    if CONFIG.is_file():
        try:
            cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
        except Exception as exc:
            sys.exit(f"{CONFIG} is not readable JSON: {exc}")
        if cfg.get("plansDir") == str(plans):
            print(f"{CONFIG}: plansDir already set")
        else:
            # not written automatically: this file is the project's, not ours
            print(f"\nAdd to {CONFIG}:\n    \"plansDir\": \"{plans}\"")
    else:
        print(f"\nno {CONFIG} — crew is not set up here. "
              f"The planning skills work without it; only the crew export needs it.")

    taiga = pathlib.Path(".claude/taiga.json")
    if not taiga.is_file():
        print(f"\nno {taiga} — Taiga output uses defaults (kanban, structure auto). "
              f"Run taiga-mirror's taiga_layout.py --init to configure it.")

    print("\nNext: brainstorm-map from a planning conversation, or architecture-map "
          "if the thinking is already done.")


if __name__ == "__main__":
    main()
