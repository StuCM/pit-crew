# Feature map schema

Same family as the architecture map, with three additions: `where`, `surface`
and a status vocabulary for existing code.

```json
{
  "id": "brainstorm-mermaid-export",
  "title": "Mermaid export for brainstorm-map",
  "summary": "One or two sentences on what is being added and to what.",
  "generated": "2026-09-20",
  "source": {"repo": "brainstorm-map", "architecture": "https://claude.ai/artifact/..."},
  "groups": [{"id": "g-build", "label": "Build pipeline", "colour": "#e08033"}],
  "parts": [ /* part objects */ ],
  "edges": [ /* edge objects, identical to architecture-map */ ],
  "layout": {"p-build": [420, -60]}
}
```

## Part

```json
{
  "id": "p-build",
  "label": "Build script",
  "group": "g-build",
  "kind": "service",
  "status": "extend",
  "purpose": "Reads the map JSON, validates it, writes the HTML.",
  "why_here": "This is where the new output format hangs.",
  "where": ["scripts/build_map.py"],
  "surface": [
    {"name": "main", "signature": "main()", "file": "scripts/build_map.py",
     "line": 91, "use": "extend", "note": "Add --format {html,mermaid,both}."}
  ],
  "open": ["Separate .mmd file, or a fenced block in a Markdown export?"],
  "traces": [{"id": "p-widget", "label": "Viewer widget"}]
}
```

| Field | Required | Notes |
|---|---|---|
| `id`, `label` | yes | Label 2–3 words. |
| `kind` | yes | `ui` `service` `job` `store` `external` `data`. |
| `status` | yes | `exists` `extend` `new` `unknown`. |
| `purpose` | yes | What it does. |
| `why_here` | yes | Which scope test it passed: we call it, it calls us, or its contract constrains us. |
| `where` | for `exists` and `extend` | Paths. The validator requires it. |
| `surface` | strongly for `extend` | The symbols. A warning without it. |
| `open` | no | Unresolved questions; renders a marker. |
| `traces` | no | `{"id","label"}` into the architecture map. |

## Surface entry

| Field | Notes |
|---|---|
| `name` | The bare symbol. Used for verification, so keep it exact — `validate`, not `validate()`. |
| `signature` | Optional, shown in the sheet in monospace. |
| `file` | Required unless `use` is `add`. Repo-relative. |
| `line` | Optional. Omit rather than guess — the verifier will find and record it. |
| `use` | See the table below. It decides whether the sheet says USING or CHANGING. |
| `change` | **Required when `use` writes code** (`modify`, `replace`, `add`). One line saying what the edit is. |
| `note` | Why, or what to watch out for. |
| `verified` | **Set by the build script. Never write it yourself.** |

### What `use` means

| `use` | Sheet shows | Meaning |
|---|---|---|
| `call` | USING · we call it | We invoke it. It does not change. |
| `read` | USING · we read it | We depend on its value or shape. It does not change. |
| `subclass` | USING · we subclass it | We inherit from it. It does not change. |
| `modify` | CHANGING · we edit it | We edit this symbol. |
| `replace` | CHANGING · we replace it | We swap its implementation. |
| `add` | CHANGING · we write it | New symbol we create. |

The split matters more than the verb: a reader needs to know at a glance
whether your feature writes into a file or merely consumes it. `extend` and
`override` are accepted as legacy spellings of `modify` and rewritten on build.

A `change` line is required for the three CHANGING uses, and the build fails
without one. "We will change the build script" is not a plan; "add a
`--format` argument and branch on it after validation" is.

`use: "add"` means a symbol that does not exist yet, so there is nothing to
verify; it is marked unverified and that is correct.

## How verification works

`build_feature.py --repo PATH` opens each `file`, and looks for the symbol name
as a whole word:

- if `line` is given, in a small window around it — a hit there verifies it
- otherwise, or if that window misses, anywhere in the file; a hit elsewhere
  verifies it **and rewrites `line`** to where it actually is
- no hit, or no such file, leaves it unverified and prints the reason

The summary line reports `found/checked`. Without `--repo`, nothing is checked
and everything is unverified — a legitimate state, and the map then reads as a
list of things to confirm.

## Common mistakes

- **Writing `verified: true` by hand.** It will be overwritten, and if it were
  not, it would defeat the entire skill.
- **Inventing line numbers.** Omit `line`. A guessed line with a correct file
  gets silently corrected; a guessed line with a guessed file gets caught, and
  you want it caught.
- **`status: "new"` for everything.** If nothing in the map already exists, the
  surrounding code was not read.
- **Parts that fail the scope rule.** If `why_here` reads like a description of
  the part rather than a reason it is on this map, it probably does not belong.
