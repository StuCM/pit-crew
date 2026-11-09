#!/usr/bin/env bash
# The shared repository, where app/reference_values.py already has
# selected_list_item_ids. Task 040 re-implements it and wraps it in a class
# used once.
source "$(dirname "${BASH_SOURCE[0]}")/../_fixture/mini-arches.sh"

cat > .claude/tasks/040-smm-reads-list-item.md <<'EOT'
---
id: 040
slug: smm-reads-list-item
status: review
branch: crew/040-smm-reads-list-item
rounds: 1
files:
  - app/functions/notify_smm.py
---

# SMM notifications read the list item id

## Approach
1. In post_save, compare the selected list item id of tile.data['team'] with the SMM list item.

## Definition of done
- [ ] SMM notifications fire for the SMM team
EOT

git switch -qc crew/040-smm-reads-list-item
cat > app/functions/notify_smm.py <<'EOT'
SMM_TEAM = "list-item-smm"


class TeamReader:
    def __init__(self, value):
        self.value = value

    def ids(self):
        if not self.value:
            return []
        if isinstance(self.value, str):
            return [self.value]
        return [entry["labels"][0]["list_item_id"] for entry in self.value if entry.get("labels")]


def post_save(tile, notify):
    if SMM_TEAM in TeamReader(tile.data["team"]).ids():
        notify("smm", tile.data["summary"])
EOT
git commit -qam "fix(notify): smm reads the team list item id"
git switch -q main
