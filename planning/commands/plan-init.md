---
description: Set up the planning layer in this project — plans directory, manifest, and the crew config keys it needs.
---

Set this repository up for the `planning` plugin.

1. Run the scaffold, which is idempotent and never overwrites an existing plan:

```sh
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/init_plan.py --name "$(basename "$PWD")"
```

2. Read what it prints. If it reports `crew.config.json` keys to add, add them —
   `plansDir` is what lets the crew skills find the maps at spec time.

3. Tell the user what now exists and what the next step is, in two or three
   lines: a plan manifest with no maps yet, and `brainstorm-map` or
   `architecture-map` as the way in depending on whether there is a planning
   conversation to work from.

Do not create any maps here. An empty scaffold is the correct output of an
init; maps come from a conversation or a repo, not from a template.
