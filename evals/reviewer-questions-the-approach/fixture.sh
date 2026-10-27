#!/usr/bin/env bash
# The shared repository, with an approved group whose brief wraps post_save
# in a converter. 030 (the converter) is merged, 031 has built the call into
# notify_smm exactly as specced, and 032 waits to do the same to licences.
source "$(dirname "${BASH_SOURCE[0]}")/../_fixture/mini-arches.sh"

cat > app/concept_compat.py <<'EOF'
OPTION_FOR_LIST_ITEM = {
    "list-item-hb": "7a1c0c0e-hb-option",
    "list-item-smm": "93f2e1aa-smm-option",
    "list-item-expired": "0c9d11b2-expired-option",
}


def to_concept_id(value):
    """The retired option id for the first selected list item."""
    for reference in value or []:
        for label in reference.get("labels", []):
            if label.get("list_item_id") in OPTION_FOR_LIST_ITEM:
                return OPTION_FOR_LIST_ITEM[label["list_item_id"]]
    return None
EOF
git add -A
git commit -qm "feat(compat): convert references back to option ids (030)"

mkdir -p .claude/crew/work
cat > .claude/crew/work/smm.json <<'EOF'
{
  "title": "Notifications and licence checks after the v8 upgrade",
  "stage": "build",
  "brief": {
    "shape": "wrap",
    "target": [{ "path": "app/functions/notify_smm.py", "name": "post_save" },
               { "path": "app/functions/licence_transfer.py", "name": "save" }],
    "direction": "Convert reference values back to option ids with app/concept_compat.py, so each function's existing comparison keeps working.",
    "rejected": [{ "option": "Change each comparison", "why": "touches more lines" }],
    "decided": ["the v8 upgrade turned these values into references"],
    "exploring": [],
    "approved": "2026-10-20"
  },
  "challenge": { "skipped": "short on time" },
  "order": ["030", "031", "032"]
}
EOF
task() {
  cat > ".claude/tasks/$1-$2.md" <<EOF
---
id: $1
slug: $2
status: $3
branch: crew/$1-$2
work: smm
rounds: $4
files:
  - $5
---

# $6

## Approach
1. $7

## Definition of done
- [ ] $8
EOF
}
task 030 concept-compat done 1 app/concept_compat.py "A converter from references to option ids" "Add to_concept_id(value) in app/concept_compat.py." "to_concept_id returns the old option id"
task 031 smm-uses-compat review 1 app/functions/notify_smm.py "SMM notifications convert before comparing" "At the top of post_save, convert tile.data['team'] with to_concept_id before the existing comparison." "SMM notifications fire for the SMM team"
task 032 licence-uses-compat approved 0 app/functions/licence_transfer.py "Licence transfer converts before comparing" "At the top of save, convert tile.data['status'] with to_concept_id before the existing comparison." "an expired licence still cannot be transferred"

git switch -qc crew/031-smm-uses-compat
cat > app/functions/notify_smm.py <<'EOF'
from app.concept_compat import to_concept_id

SMM_TEAM = "93f2e1aa-smm-option"


def post_save(tile, notify):
    if to_concept_id(tile.data["team"]) == SMM_TEAM:
        notify("smm", tile.data["summary"])
EOF
git commit -qam "fix(notify): smm converts the team reference before comparing"
git switch -q main
