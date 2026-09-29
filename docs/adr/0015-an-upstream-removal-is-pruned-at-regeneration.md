---
status: accepted
---

# An upstream removal is pruned at regeneration

When an upstream deletes or renames a skill folder, Renovate still bumps the entry's
`sha` — it cannot see folders. Under [ADR-0010](0010-vendor-a-shared-skills-tree-on-main.md)
that bump failed `validate` on `gen-skills-tree.js --verify-paths` and stayed red
for good. It held back every other entry from the same repo, and regeneration,
which only runs after a merge, never saw the removal. Nothing removed the entry: the
only path was a person running `/add-external-skill update`.

**The generator prunes it.** A regeneration resolves every entry first. One whose
`path` no longer exists at its `sha` leaves the catalog, its name leaves every
bundle's `dependencies` with a breaking bump of that bundle's `version`, and the
README is regenerated. The regeneration PR carries all of it, lists what was pruned
and what left the tree in its body, and **merges itself** like any other
([ADR-0011](0011-the-regeneration-pr-merges-itself.md)). Its body is the notice:
the uninstall steps are in it and in the README's *When a skill leaves the catalog*.

**`--verify-paths` no longer fails on a missing path.** It names the entries the
next regeneration will prune and exits 0, so the Renovate PR can merge and
regeneration can run. `--check` does fail while the catalog still lists one: after
a regeneration there is nothing left to prune, so a hit there means the prune did
not happen.

**Two removals are refused, loudly.** The regeneration run goes red, which stops the
catalog advancing until someone decides:

- a **non-bundle** that depends on the entry — `mode-router`'s hook routes to the
  modes it lists, so dropping one changes behaviour, not packaging;
- a **bundle losing the skill it is named after** (`triage` from `triage-bundle`) —
  what is left has no reason to exist.

## Consequences

- **A rename is pruned like a delete.** This is `sandbox-sdk`'s case from ADR-0010:
  upstream split one folder into three. The old entry now leaves the catalog on its
  own instead of blocking a PR, and the new folders still need an
  `/add-external-skill`. The PR body says so. ADR-0010 wanted a *silent* drop made
  impossible, and a named one in a PR is not silent.
- **A typo in a hand-added entry no longer blocks its PR.** It merges, and the next
  regeneration prunes it in a PR that names it.
- **`main` briefly carries an entry that installs nothing**, between the Renovate
  merge and the regeneration merge, which is minutes when the token is valid.
- **A skill gone from inside an entry** (a whole-plugin one, or `shell-scripting`)
  prunes nothing: the entry still resolves, and the tree loses the skill. The PR body
  lists it under *Skills leaving the tree*, because a description naming it is prose
  no script rewrites.

## Considered and rejected

- **Pruning on the Renovate PR**, as a commit on its branch or a separate PR. This
  needs a second workflow on `renovate/*` branches, puts a catalog change inside the
  PR whose single `sha` line is the point (ADR-0010), and would leave the removal
  ahead of the tree it removes.
- **Keeping the regeneration PR open for a human when it prunes.** A removal does
  break existing installs, but a PR waiting on a person also holds every later tree
  behind it. The catalog entry was reviewed when it was added; what upstream did
  since is a fact to record, not a decision to take.
- **Failing only when the path never existed** (a typo) and pruning when it existed
  at the previous `sha`. This is more precise, but costs a second clone per changed
  entry, and a typo pruned in a named PR is already loud.
