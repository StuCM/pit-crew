#!/usr/bin/env bash
# A small repository with coral-arches' real problem in it: a v8 upgrade
# turned concept and domain-value nodes into references, one caller was
# fixed in #855 with a shared helper, and three others still compare against
# a retired option id. Built fresh in the eval's empty workspace.
set -euo pipefail

git init -q -b main
git config user.email eval@example.com
git config user.name eval
mkdir -p app/functions tests .claude/tasks .claude/crew

cat > .claude/crew.config.json <<'EOF'
{ "project": "mini-arches", "verify": "python3 -m unittest -q", "baseBranch": "main" }
EOF
cat > .claude/crew/project.md <<'EOF'
# Project brief

## Hard constraints
Tile values for controlled-list nodes are reference values, not option ids.

## What this environment cannot prove
Nothing: the unit tests run locally.
EOF
cat > README.md <<'EOF'
# mini-arches

Functions run when a tile is saved. Each one reads the tile and may recieve a
notification target.
EOF
cat > app/functions/notify_planning.py <<'EOF'
HB_TEAM = "7a1c0c0e-hb-option"


def post_save(tile, notify):
    if tile.data["team"] == HB_TEAM:
        notify("hb", tile.data["summary"])
EOF
cat > app/functions/notify_smm.py <<'EOF'
SMM_TEAM = "93f2e1aa-smm-option"


def post_save(tile, notify):
    if tile.data["team"] == SMM_TEAM:
        notify("smm", tile.data["summary"])
EOF
cat > app/functions/update_activity_name.py <<'EOF'
def post_save(tile, resource):
    resource.name = f"ACT {tile.data['activity_type']}"
EOF
cat > app/functions/licence_transfer.py <<'EOF'
EXPIRED = "0c9d11b2-expired-option"


def save(tile):
    if tile.data["status"] == EXPIRED:
        raise ValueError("an expired licence cannot be transferred")
EOF
cat > tests/test_functions.py <<'EOF'
import unittest


class Placeholder(unittest.TestCase):
    def test_imports(self):
        import app.functions.notify_smm  # noqa: F401
EOF
touch app/__init__.py app/functions/__init__.py
git add -A
git commit -qm "feat: tile functions for planning, smm, activities and licences"

cat > UPGRADE.md <<'EOF'
# v8 upgrade

Concept and domain-value nodes are now `reference` nodes. A reference value is
a list of `{ "uri", "labels": [{ "value", "list_item_id" }] }`, so comparing a
tile value against an old option id never matches.
EOF
git add -A
git commit -qm "chore: upgrade to v8 — concept and domain-value nodes become references"

cat > app/reference_values.py <<'EOF'
def selected_list_item_ids(value):
    """Every list item id selected in a reference value, whatever its shape."""
    if not value:
        return []
    if isinstance(value, str):
        return [value]
    return [entry["labels"][0]["list_item_id"] for entry in value if entry.get("labels")]


def reference_label(value):
    """The label of the first selected item, for display."""
    for entry in value or []:
        for label in entry.get("labels", []):
            return label["value"]
    return ""
EOF
cat > app/functions/notify_planning.py <<'EOF'
from app.reference_values import selected_list_item_ids

HB_TEAM = "list-item-hb"


def post_save(tile, notify):
    if HB_TEAM in selected_list_item_ids(tile.data["team"]):
        notify("hb", tile.data["summary"])
EOF
cat > CHANGELOG.md <<'EOF'
# Changelog

## 8.4.0
- fix(notify): planning notifications read the selected list item id rather than
  comparing against the retired option id (#855)
EOF
git add -A
git commit -qm "fix(notify): planning reads the list item id, not the retired option id (#855)"
