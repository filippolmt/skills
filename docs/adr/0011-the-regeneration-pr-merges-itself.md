---
status: accepted
---

# The regeneration PR merges itself

[ADR-0010](0010-vendor-a-shared-skills-tree-on-main.md) split the catalog's
automatic flow in two: Renovate bumps a `sha` in its own one-line PR, and the
`regenerate` workflow lands the tree afterwards in a `chore: regenerate skills
tree` PR. Renovate's half mostly merges itself already — `automerge: true` in the
`packageRules` of `renovate.json`, for digest updates and for `minor`/`patch`
tags, a **major** tag bump deliberately excluded. The second half did not merge at
all, so every upstream bump left a PR sitting open on a generated artifact,
waiting for a human to press a button.

## What was decided

**`regenerate` merges the PR it opens, itself, in the same job.** Three steps at
the end: dispatch `validate` against the branch, wait for its verdict, merge on
green. The catalog now moves from an upstream tag to a vendored tree on `main`
with no hand on it.

**The dispatch is what makes any merge possible.** `main` protects one required
check, `validate`, pinned to the GitHub Actions app. A branch pushed with
`GITHUB_TOKEN` triggers no workflow — the caveat ADR-0010's workflow comment
already recorded — so `validate` never arrives on the regeneration PR and the PR
can never satisfy protection. `workflow_dispatch` on `validate.yml` closes it: the
job asks for the run it needs, and the check that run reports is the real suite,
not a status posted by the job that wants to merge. Dispatching is an Actions API
write, so the job's explicit `permissions:` block has to name `actions: write` —
an explicit block sets every scope it omits to `none`, which is a 403 at the
dispatch and a flow that stops after pushing the branch.

**The dispatched check is not counted on the pull request, so the run mirrors its
own verdict as a commit status.** This was measured, not assumed — the first
attempt merged nothing and said why: *"not mergeable: the base branch policy
prohibits the merge"*. On PR #206's head commit the check run was there and
correct (`validate`, app id 15368, `success`), while the PR's own
`statusCheckRollup` was **empty**, and no ruleset or review requirement was in
play. A dispatched run's check suite is simply not associated with the pull
request, so protection does not count it. A **commit status** it does count, so
`validate.yml`'s last step posts one — `context: validate`, the run's own verdict,
on the sha it ran against, and only on a dispatched run.

Note what this is not: a status the merging job posts about itself, which is
rejected below. It is the validating run reporting the suite it just finished, and
it carries the run's URL. And because protection re-evaluates asynchronously, the
merge retries for a minute before giving up loudly rather than reading the first
rejection as final.

**Waiting for the verdict, not arming auto-merge.** `gh pr merge --auto` was the
first shape, and it hides the failure: a red `validate` leaves an armed PR parked
with nobody told, and a stalled catalog is exactly the quiet failure this repo's
decisions keep refusing. Waiting inverts it — `gh run watch --exit-status` adopts
the verdict, so a bad tree turns the `regenerate` run **red**, where a failure is
visible, and the PR stays open next to it. It also drops three problems that were
auto-merge's alone: whether a dispatched check satisfies a check pinned to an app
id, whether arming is rejected while GitHub is still computing mergeability on a
fresh PR, and re-arming an already-armed PR on the second regeneration of a cycle.
The cost is a job that idles for `validate`'s half-minute.

**The run is matched by head `sha`, not by "most recent".** The branch is
long-lived by design, so a previous cycle's dispatched run sits right there to be
mistaken for this one — and a merge on a stale verdict is the one outcome worse
than not merging.

**What a dispatched run checks is the branch head**, where a `pull_request` run
gets `refs/pull/N/merge`. Same tree as the commit, one merge short of the base: if
`main` moves after the check goes green, the squash lands a tree validated against
the older base. It is the acceptable half because a `main` push that touches the
catalog, the generator or the tree **retriggers regeneration**, which force-pushes
the branch from the new base and validates again; and a push that touches none of
them cannot make the tree wrong. The residue is a stale tree on `main` for one
cycle, which the next regeneration corrects.

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
  the tree and merges. The right shape, and the first thing to reach for, but this
  repo runs the **hosted** Mend app (`app/renovate`), which forbids
  `postUpgradeTasks`; it needs a self-hosted Renovate with
  `allowedPostUpgradeCommands`. Self-hosting Renovate to save a workflow that
  already exists is a bad trade. It would also undo ADR-0010's reason for the
  split: the tree diff would bury the one line the Renovate PR exists to show.
- **`gh pr merge --auto`**, arming GitHub's platform auto-merge. See above: it
  merges the same PR while hiding the failure. Worth noting the small
  inconsistency it would have introduced — `renovate.json` sets
  `"platformAutomerge": false`, so Renovate merges its own PRs through the API
  rather than through the feature this job would have leaned on.
- **A PAT or GitHub App token for the push**, so `validate` triggers by itself. It
  works and needs no dispatch, at the cost of a secret to store, scope and rotate.
  The dispatch buys the same thing with a permission line and no credential.
- **`gh pr merge --admin`**, bypassing protection. `GITHUB_TOKEN` has write, not
  admin, so it fails — and it would merge with nothing verified.
- **Dropping `validate` from the required checks**, or moving `main` to a ruleset
  with the Actions app as a bypass actor. Both make the regeneration PR mergeable
  by weakening the guard for every other PR.
- **Pushing the tree straight to `main`**, no PR. Branch protection blocks it, and
  it would erase the audit record the PR is kept for.
- **A self-reported `validate` commit status** from the **regeneration** job, whose
  pre-push suite is close to the real one. Close, not equal: it adds
  `gen-skills-tree.js --check` and omits `claude plugin validate .`. A required
  check a job raises on itself is a check in name only. Note the difference from
  what was chosen: the status is posted by the dispatched `validate` run about its
  own suite, not by the job that wants the merge.
- **A PAT or GitHub App token, revisited.** It remains the shape GitHub actually
  designs for: push as a real identity, `validate` triggers as a `pull_request`
  run, the PR's rollup is populated, and neither the dispatch nor the status
  mirror is needed. It stays rejected only for the secret — one credential to
  store, scope and rotate, whose silent expiry would stop the flow. If the status
  route ever breaks, this is the fallback, and it is a smaller change than it
  looks.

## Consequences

- **A failing `validate` fails the `regenerate` run** and leaves the PR open. The
  catalog stops advancing until someone deals with it, which is the intended
  behaviour for a tree that must not land — and the red run is what says so.
- **The merge is performed with `GITHUB_TOKEN`, so it triggers no workflow.**
  `validate` therefore does not re-run on `main` after a regeneration merge, which
  costs nothing: the same suite passed on the same tree moments earlier. It also
  means the push does not retrigger `regenerate` despite matching its `skills/**`
  path filter. Should GitHub ever attribute that merge differently, the only effect
  is one extra run that stops at "tree already current".
- **`delete_branch_on_merge` removes the branch**, and the next regeneration
  recreates it. The long-lived-branch reasoning in the job is unaffected: it is
  about not stacking PRs within one open cycle.
- **`workflow_dispatch` must be on the default branch to be dispatchable.** It is
  from the moment this decision merges; a `regenerate` run before that fails at the
  dispatch line, with the branch already pushed.
- **`validate` now has an explicit `permissions:` block**, so every scope it needs
  is spelled out — `statuses: write` for the mirror, and `contents: read` for the
  checkout that used to come free. Adding a step that needs another scope means
  adding it here; that is the trade for not running the whole suite with write
  access to everything.
- **The `validate` context can now arrive two ways** — a check run on a pull
  request, a commit status on a dispatched run — and branch protection is
  satisfied by either. Worth knowing before pinning that context harder: the
  status is created by `GITHUB_TOKEN`, so tightening the required check to
  check-runs-only would silently strand the regeneration PR again.
- **The test suite moved into `scripts/run-tests.sh`**, because `validate` and
  `regenerate` both run it and the two copies had already diverged — one carried the
  empty-glob guard, the other passed silently on nothing. One copy, one guard, and
  `CLAUDE.md` documents the same command a human runs.
