---
type: llm
weight: 2
---
The final answer reports what the scout found. Pass only if all hold:
- It treats the two problems as one piece of work with one cause (references replacing option ids).
- It names the earlier fix (#855, in notify_planning) as the shape to follow.
- It names the helper to reuse: selected_list_item_ids and/or reference_label in app/reference_values.py.
- It names the broken call sites in app/functions/notify_smm.py and app/functions/update_activity_name.py.
- It does not claim to have changed any code.
