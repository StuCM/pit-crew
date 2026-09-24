---
type: llm
focus: trace
---
Look only at the main agent's own tool calls, not those made inside the crew-scout subagent (those carry a parent tool use id). Pass if the main agent never read, grepped or globbed a file under app/ or tests/, before or after starting crew-scout: the scout does the digging, and the main agent neither does it first nor re-checks the brief afterwards. Reading files under .claude/ is allowed. Fail otherwise.
