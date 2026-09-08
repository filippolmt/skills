---
status: accepted
---

# The regeneration PR merges itself

[ADR-0010](0010-vendor-a-shared-skills-tree-on-main.md) split the catalog's
automatic flow in two: Renovate bumps a `sha` in its own one-line PR, and the
`regenerate` workflow lands the tree afterwards in a `chore: regenerate skills
tree` PR. Renovate's half already merges itself — `automerge: true` on both
`customManager` rules in `renovate.json`. The second half did not, so every
upstream bump left a PR sitting open waiting for a human to press a button on a
generated artifact.

## What was decided

**`regenerate` arms auto-merge on the PR it opens.** Two lines at the end of the
job: `gh workflow run validate.yml --ref "$branch"`, then
`gh pr merge --auto --squash "$pr"`. The catalog now moves from an upstream tag
to a vendored tree on `main` with no hand on it.

**The dispatch is what makes auto-merge possible.** `main` protects one required
check, `validate`, pinned to the GitHub Actions app. A branch pushed with
`GITHUB_TOKEN` triggers no workflow — that is the caveat ADR-0010's workflow
comment already recorded — so `validate` would never arrive on the regeneration
PR and auto-merge would wait forever. `workflow_dispatch` on `validate.yml`
closes it: a dispatched run attaches its check to the branch head, which is the
sha branch protection reads. The check is therefore **real** — the same suite
every human PR passes, run against the exact tree being merged, not a status
posted by the job that wants to merge.

The job keeps its own inline validation before the push anyway. It is not
redundant: it fails the regeneration *before* a branch exists, and it is the only
place `gen-skills-tree.js --check` runs at all.

**Nobody reviews the tree, and that is the point.** ADR-0010 named the
regeneration PR as the place redistribution "shows". That still holds, but the
place it is *decided* is the catalog entry — added by hand through
`/add-external-skill`, in a human-reviewed PR, where the licence question is
settled. The regeneration PR only materialises what the catalog already commits
to; reviewing generated files whose correctness a `--check` answers exactly is
work that produces nothing. The PR survives as the audit record: it is where the
diff is visible in history, whether or not anyone looked.

## Considered and rejected

- **`postUpgradeTasks` in Renovate** — one PR that bumps the `sha`, regenerates
  the tree and merges. The user's first instinct, and the right shape, but this
  repo runs the **hosted** Mend app (`app/renovate`), which forbids
  `postUpgradeTasks`; it needs a self-hosted Renovate with
  `allowedPostUpgradeCommands`. Self-hosting Renovate to save a workflow that
  already exists is a bad trade. It would also undo ADR-0010's reason for the
  split: the tree diff would bury the one line the Renovate PR exists to show.
- **A PAT or GitHub App token for the push**, so `validate` triggers by itself.
  It works and needs no dispatch, at the cost of a secret to store, scope and
  rotate. The dispatch buys the same thing with two lines and no credential.
- **`gh pr merge --admin`**, bypassing protection. `GITHUB_TOKEN` has write, not
  admin, so it fails — and it would merge with nothing verified.
- **Dropping `validate` from the required checks**, or moving `main` to a ruleset
  with the Actions app as a bypass actor. Both make the regeneration PR mergeable
  by weakening the guard for every other PR.
- **Pushing the tree straight to `main`**, no PR. Branch protection blocks it,
  and it would erase the audit record the PR is kept for.
- **A self-reported `validate` commit status** from the regeneration job, whose
  inline suite is nearly the same. Nearly: it lacks `claude plugin validate .`.
  A required check a job raises on itself is a check in name only.

## Consequences

- **A failing `validate` parks the PR instead of merging it.** Auto-merge stays
  armed and the branch is where the failure sits, which is the correct place for
  a tree that must not land.
- **The merge is a push to `main` touching `skills/**`, which is in
  `regenerate`'s path filter**, so it retriggers the workflow. The
  `changed=false` guard stops that second run at "tree already current" — no
  loop, one wasted minute per bump.
- **`delete_branch_on_merge` removes the branch**, and the next regeneration
  recreates it. The long-lived-branch reasoning in the job is unaffected: it is
  about not stacking PRs within one open cycle.
- **`workflow_dispatch` must be on the default branch to be dispatchable.** It is
  from the moment this decision merges; a `regenerate` run before that fails at
  the dispatch line, with the branch already pushed.
