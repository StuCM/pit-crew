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
