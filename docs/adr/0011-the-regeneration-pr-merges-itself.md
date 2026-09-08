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

**`regenerate` approves its own PR's parked check, waits for it, and merges.**
Three things at the end of the job: find the `pull_request` run of `validate` for
the sha just pushed, approve it if it is waiting, adopt its verdict. The catalog
now moves from an upstream tag to a vendored tree on `main` with no hand on it.

**The blocker was a parked run, and finding that took two wrong turns.** Both are
recorded here because the next person will otherwise re-take them.

A branch pushed with `GITHUB_TOKEN` triggers no workflow — the caveat ADR-0010's
workflow comment recorded, and true as far as it goes. What it does not say is
what GitHub does instead: it **creates** the `pull_request` run of `validate` and
parks it, `status: completed`, `conclusion: action_required`, zero check runs — a
run awaiting approval. The required check is not missing. It is waiting.

That was found by differential, after a measurement was misread. On the blocked
PR's head commit sat three check suites, all associated with the PR: Renovate's
(`queued`, zero runs), a `github-actions` suite with the green `validate` run, and
a second `github-actions` suite concluding `action_required` with zero runs. The
same commit's `statusCheckRollup` was empty, which was first read as "a dispatched
run's check suite is not associated with the pull request". It is associated —
`pull_requests: [206]`, on both the run and its suite. The comparison that settled
it was against a healthy PR: same Renovate `queued` suite, same green run,
**no** `action_required` suite. One difference, one cause. Approving the parked run
turned the PR from `BLOCKED` to `CLEAN` in one call.

**So the check is a real `pull_request` check, with nothing mirrored or
dispatched.** It reports on the PR like any other, which also means it validates
`refs/pull/N/merge` — the merge commit, not the branch head. The earlier shapes
could not: a dispatched run checks out the branch head, so it validated a tree one
merge short of its base.

**Waiting for the verdict, not arming auto-merge.** `gh pr merge --auto` was the
first shape, and it hides the failure: a red `validate` leaves an armed PR parked
with nobody told, and a stalled catalog is exactly the quiet failure this repo's
decisions keep refusing. Waiting inverts it — `gh run watch --exit-status` adopts
the verdict, so a bad tree turns the `regenerate` run **red**, where a failure is
visible, and the PR stays open next to it. The cost is a job that idles for
`validate`'s half-minute.

**The run is matched by head `sha`, not by "most recent".** The branch is
long-lived by design, so a previous cycle's run sits right there to be mistaken
for this one — and a merge on a stale verdict is the one outcome worse than not
merging.

**Approving is conditional, and the flip is waited for.** GitHub may not park the
run at all, and approving a running one is an error rather than a no-op; while
`gh run watch` against a run still marked `action_required` returns that
conclusion at once and reads as the verdict. Both are bounded waits that fail
loudly.

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
- **`workflow_dispatch` on `validate.yml`, plus a commit status mirroring the
  verdict.** Built, merged, and measured wrong — see above. It raised a green
  `validate` check on the commit and the merge was still refused, because the
  parked `pull_request` run was the blocker and nothing had touched it. The mirror
  was then added to satisfy protection by another road, on a diagnosis that turned
  out to be false. Both are gone: the trigger, the status step, and the
  `statuses: write` grant it needed. Approving the run GitHub already made is
  smaller and truer.
- **A PAT or GitHub App token for the push**, so the run starts unparked and needs
  no approval. It is the shape GitHub designs for and it works, at the cost of a
  credential to store, scope and rotate, whose silent expiry would stop the flow.
  With `actions: write` the parked run can simply be approved, which buys the same
  thing with no secret. This is the fallback if approval is ever withdrawn from
  `GITHUB_TOKEN`.
- **`gh pr merge --admin`**, bypassing protection. `GITHUB_TOKEN` has write, not
  admin, so it fails — and it would merge with nothing verified.
- **Dropping `validate` from the required checks**, or moving `main` to a ruleset
  with the Actions app as a bypass actor. Both make the regeneration PR mergeable
  by weakening the guard for every other PR.
- **Relaxing the repo's approval policy for workflow runs**, so nothing parks in
  the first place. It would work, and it lowers the bar for every contributor's
  first PR, not just this bot's.
- **Pushing the tree straight to `main`**, no PR. Branch protection blocks it, and
  it would erase the audit record the PR is kept for.
- **A self-reported `validate` commit status** from the regeneration job, whose
  pre-push suite is close to the real one. Close, not equal: it adds
  `gen-skills-tree.js --check` and omits `claude plugin validate .`. A required
  check a job raises on itself is a check in name only.

## Consequences

- **`actions: write` is required**, and an explicit `permissions:` block sets every
  scope it omits to `none`. Approving a run, listing runs and watching one are all
  Actions API calls; without that line the flow stops after pushing the branch.
- **A failing `validate` fails the `regenerate` run** and leaves the PR open. The
  catalog stops advancing until someone deals with it, which is the intended
  behaviour for a tree that must not land — and the red run is what says so.
- **The merge is performed with `GITHUB_TOKEN`, so it triggers no workflow.**
  `validate` therefore does not re-run on `main` after a regeneration merge, which
  costs nothing: the same suite passed on the same merge ref moments earlier. It
  also means the push does not retrigger `regenerate` despite matching its
  `skills/**` path filter.
- **An open regeneration PR does not heal itself.** Nothing re-approves a parked
  run outside a regeneration cycle, so a PR left blocked by an earlier failure
  waits for the next `regenerate` run — triggered by the next catalog-touching
  push to `main`, or by `gh workflow run regenerate.yml`.
- **`delete_branch_on_merge` removes the branch**, and the next regeneration
  recreates it. The long-lived-branch reasoning in the job is unaffected: it is
  about not stacking PRs within one open cycle.
- **The test suite moved into `scripts/run-tests.sh`**, because `validate` and
  `regenerate` both run it and the two copies had already diverged — one carried the
  empty-glob guard, the other passed silently on nothing. One copy, one guard, and
  `CLAUDE.md` documents the same command a human runs.
