#!/usr/bin/env bash
# The shared repository, plus a briefed piece of work whose plan builds around
# notify_smm.post_save instead of changing it the way #855 changed planning.
source "$(dirname "${BASH_SOURCE[0]}")/../_fixture/mini-arches.sh"

mkdir -p .claude/crew/work
cat > .claude/crew/work/smm.json <<'EOF'
{
  "title": "SMM notifications after the v8 upgrade",
  "summary": "SMM notifications come out blank: the v8 upgrade turned the team value into references.",
  "stage": "approve",
  "brief": {
    "shape": "wrap",
    "target": [{ "path": "app/functions/notify_smm.py", "name": "post_save" }],
    "direction": "Add app/concept_compat.py with to_concept_ids(), and call it at the top of notify_smm.post_save so the existing option-id comparison keeps working.",
    "rejected": [{ "option": "Change the comparison in post_save", "why": "touches more lines" }],
    "decided": [
      "convert the references back to concept ids before comparing"
    ],
    "exploring": []
  },
  "order": ["030", "031"]
}
EOF
cat > .claude/tasks/030-concept-compat.md <<'EOF'
---
id: 030
slug: concept-compat
status: draft
work: smm
files:
  - app/concept_compat.py
  - tests/test_concept_compat.py
---

# A converter from references back to concept ids

## Goal
to_concept_ids(value) turns a reference list into the old option ids.

## Approach
1. Add app/concept_compat.py with to_concept_ids(value), mapping each reference's list item to its old option id.
2. Test it.
EOF
cat > .claude/tasks/031-smm-uses-compat.md <<'EOF'
---
id: 031
slug: smm-uses-compat
status: draft
work: smm
files:
  - app/functions/notify_smm.py
---

# SMM notifications convert before comparing

## Goal
SMM notifications fire again.

## Approach
1. At the top of post_save in app/functions/notify_smm.py, pass tile.data["team"] through to_concept_ids before the existing comparison.
EOF
