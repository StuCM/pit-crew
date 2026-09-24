---
type: llm
weight: 2
---
The response asks the person questions before searching, scouting or writing a spec. Pass only if all hold:
- It asks between three and five questions, numbered so they can be answered by number.
- It either asks what changed recently (an upgrade, a migration, a data type changing shape), or plays back the change the person already named and asks what it did.
- At least one asks whether something like this has been fixed before, and where.
- It makes clear that "I don't know" is an acceptable answer, or words to that effect.
- It does not propose or describe a fix yet, and does not claim to have found the cause.
