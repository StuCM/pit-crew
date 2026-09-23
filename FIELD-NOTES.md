# Field notes

Issues hit while using crew for real. Newest section last. Test bed:
`~/git/personal/arches-map` (empty repo, new Arches plugin), 2026-09-22.

## 2026-09-22 — arches-map, first init

### `crew init --help` runs the install
`crew init --help` does not print help — it performs the install and prints the
"wrote / ready / updated" report plus `next:` steps. Any `--help` on a
subcommand should be inert. Cost: an unintended write into a repo I was still
inspecting. (Harmless here; would not be in a repo with an existing
`.claude/settings.json`.)

### `scopes.fromDir` defaults to `src`, which is wrong on arrival
Fresh init writes `"fromDir": ["src"]`, then `crew doctor` immediately reports
it as a problem because the directory does not exist. A default that always
fails doctor on a non-`src` project is noise. Either infer from the tree at
init time, or write `[]` and let doctor say "unset" like it does for `project`
and `verify`.

### `crew-setup` has nothing to read on a greenfield repo
The setup skill is built to fill the config by reading the repository. On an
empty repo there is no tree to read, so every value has to come from the user
anyway. Worth a greenfield path: ask the few questions directly rather than
searching for evidence that cannot exist.

### Global `core.hooksPath` silently owns the git hooks
`skipped hooks (a global core.hooksPath already covers this repo)` is correct
and useful. Noting it only because a per-repo hook expectation would be wrong
here, and anything later blaming "the commit hook didn't fire" should look
there first.

## 2026-09-23 — coral-arches, several fixes after the v8 upgrade

Test bed: `flaxandteal/coral-arches`, brownfield, fixing several features at
once. Declined the plan offer, since it was fixes and not a feature.

### Long run, nothing usable built
The spec went to a worker without the one fact that explained most of the
issues: the v8 upgrade turned concept and domain-value nodes into `reference`,
so every `tile.data[node]() === '<option id>'` comparison silently never
matches. The v8.4.0 changelog has about a dozen fixes with that one cause, and
`coral/media/js/utils/reference-values.js` / `coral/utils/reference_values.py`
already hold the helpers. Nothing asked for it, so nothing found it. The worker
is told not to explore and to block on a thin spec, so a spec without that fact
cannot turn into a fix.

### Nobody asked what I knew
`crew-spec` went from routing straight to graph queries and a spec. On a
brownfield repo most of the context is in the person's head: what changed, what
was fixed before, what the helper is called. It needs asking, with questions
specific enough to answer quickly.

### Approving a spec is hard to engage with
It was a whole spec and a yes/no question. I did not check the tasks properly,
and a wrong spec is the most expensive thing in the loop.

### The orchestrator does too much
It did its own research, so its context filled with file dumps. When I asked
about something off-plan, it started doing that as well rather than parking it.
Greenfield (reflex) ran smoother, because there the spec can hold everything.

### The graph only read one hop
Every `crew graph` read was one hop, and `find` was a substring match. The
store has a lot of related work across the Arches projects, linked through
CrossLinks, and none of it was reachable by following links.
