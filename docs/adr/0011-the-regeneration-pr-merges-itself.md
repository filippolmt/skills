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

Why that took three attempts is in *What was measured*, below. The short version:
`main` requires one check, `validate`, and a branch pushed with `GITHUB_TOKEN`
cannot get it. Not because the check goes missing — because GitHub creates its
`pull_request` run and **parks** it, awaiting an approval that no token inside a
workflow can give.

## What was decided

**The push uses a `REGEN_TOKEN` secret, and the job then waits and merges.** Three
things at the end of the job: find the `pull_request` run of `validate` for the sha
just pushed, adopt its verdict, merge the PR — the last with a short bounded retry,
because branch protection re-evaluates asynchronously and one rejection is not
final. The catalog now moves from an upstream tag to a vendored tree on `main` with
no hand on it.

**A real identity is the whole point.** `REGEN_TOKEN` is a
fine-grained PAT or GitHub App installation token; the checkout carries it, so the
push inherits it, so the `pull_request` run starts by itself and reports on the PR
like any other check. That is also what makes the check honest: nothing is
dispatched, nothing is mirrored, and no job raises the check it wants to merge on.
Because the run is a genuine `pull_request` run it checks out `refs/pull/N/merge`
— the merge commit — where the abandoned shapes could only validate the branch
head. With `strict: false` on the protection that merge ref is still computed at
check time rather than pinned, so a base moving underneath is reduced, not retired;
the residue is bounded by regeneration retriggering on any catalog-touching push.

**The cost is a credential**, and it is the one this decision accepts knowingly: a
secret to store, scope and rotate, whose expiry stops the flow. It stops it
*loudly* — the first step of the job fails with the name of the secret and a
pointer here when it is empty. GitHub's own remedies for a parked run are a PAT, a
GitHub App, or a human clicking approve; there is no fourth.

**Waiting for the verdict, not arming auto-merge.** `gh pr merge --auto` was the
first shape, and it hides the failure: a red `validate` leaves an armed PR parked
with nobody told, and a stalled catalog is exactly the quiet failure this repo's
decisions keep refusing. Waiting inverts it — `gh run watch --exit-status` adopts
the verdict, so a bad tree turns the `regenerate` run **red**, where a failure is
visible, and the PR stays open next to it. The cost is a job that idles for
`validate`'s half-minute.

**The run is matched by head `sha`, not by "most recent".** The branch is
long-lived by design, so a previous cycle's run sits right there to be mistaken
for this one, and a merge on a stale verdict is the one outcome worse than not
merging. This leans on the runs API reporting `head_sha` as the PR head even for a
run that checks out the merge ref; if that ever changed, the match fails as "no run
appeared" rather than silently matching the wrong tree.

**Nobody reviews the tree, and that is the point.** ADR-0010 named the
regeneration PR as the place redistribution "shows". That still holds, but the
place it is *decided* is the catalog entry — added by hand through
`/add-external-skill`, in a human-reviewed PR, where the licence question is
settled. The regeneration PR only materialises what the catalog already commits
to; reviewing generated files whose correctness a `--check` answers exactly is
work that produces nothing. The PR survives as the audit record: it is where the
diff is visible in history, whether or not anyone looked.

## What was measured

Two mechanisms were built and abandoned before this one, and both died on the same
misreading. They are recorded because the next person will otherwise rebuild them.

The first arming of auto-merge could not even reach the merge: `gh workflow run`
returned 403, because an explicit `permissions:` block sets every scope it omits to
`none` and dispatching is an Actions API write.

With `actions: write` added, the dispatched `validate` ran green in 38s and the
merge was **still** refused — *"the base branch policy prohibits the merge"*. The
blocked PR's head commit was then read as carrying an unassociated check suite, and
a commit-status mirror was built on that reading. It was wrong. Re-measured, both
the run and its suite carried `pull_requests: [206]`; what actually differed from a
healthy PR was a **third** check suite, `github-actions`, `conclusion:
action_required`, zero check runs. One difference, one cause: the `pull_request`
run of `validate` existed and was waiting for approval.

Approving it by hand cleared the PR from `BLOCKED` to `CLEAN` — and that is where
the third reading nearly repeated the mistake. The approval did not resume the
parked attempt; it created **attempt 2, attributed to the approver**, a repo admin.
The parking policy exists precisely to demand an identity other than
`github-actions[bot]`, so a workflow approving its own parked run is not a smaller
version of the fix. It is the thing the control is there to prevent.

Hence a real identity on the push, which is where this started.

## Considered and rejected

- **`postUpgradeTasks` in Renovate** — one PR that bumps the `sha`, regenerates
  the tree and merges. The right shape, and the first thing to reach for, but this
  repo runs the **hosted** Mend app (`app/renovate`), which forbids
  `postUpgradeTasks`; it needs a self-hosted Renovate with
  `allowedPostUpgradeCommands`. Self-hosting Renovate to save a workflow that
  already exists is a bad trade. It would also undo ADR-0010's reason for the
  split: the tree diff would bury the one line the Renovate PR exists to show.
- **`workflow_dispatch` on `validate.yml`, plus a commit status mirroring the
  verdict.** Built, merged, measured wrong — above. A dispatched run also checks
  out the branch head rather than the merge ref, and the status had to be trusted
  on an unverifiable claim about how a required check pinned to an app id treats a
  status. Both are gone: the trigger, the status step, and the `statuses: write`
  grant it needed.
- **The workflow approving its own parked run**, with `actions: write`. Smaller
  than a secret and it reads as elegant, which is why it got as far as being
  built. See above: the approval creates a new attempt attributed to the approver,
  and a bot approving itself is what the policy forbids.
- **Relaxing the repo's approval policy for workflow runs**, so nothing parks in
  the first place. It would work, and it lowers the bar for every contributor's
  first PR, not just this bot's.
- **`gh pr merge --admin`**, bypassing protection. It would merge with nothing
  verified.
- **Dropping `validate` from the required checks**, or moving `main` to a ruleset
  with the Actions app as a bypass actor. Both make the regeneration PR mergeable
  by weakening the guard for every other PR.
- **Pushing the tree straight to `main`**, no PR. Branch protection blocks it, and
  it would erase the audit record the PR is kept for.
- **A self-reported `validate` commit status** from the regeneration job, whose
  pre-push suite is close to the real one. Close, not equal: it adds
  `gen-skills-tree.js --check` and omits `claude plugin validate .`. A required
  check a job raises on itself is a check in name only.

## Consequences

- **`REGEN_TOKEN` has to exist, and has to be renewed.** Scope it to this
  repository with `contents: write` and `pull-requests: write` — enough to push the
  branch, open the PR and merge it, and nothing more. A fine-grained PAT expires;
  when it does, `regenerate` fails on its first step with the secret's name. A
  GitHub App installation token avoids the expiry at the cost of an app to own.
- **`GITHUB_TOKEN` is down to `contents: read`.** It does none of the work, so it
  holds none of the permissions it used to: no `contents: write`, no
  `pull-requests: write`, no `actions: write`, no `statuses: write`.
- **A failing `validate` fails the `regenerate` run** and leaves the PR open. The
  catalog stops advancing until someone deals with it, which is the intended
  behaviour for a tree that must not land — and the red run is what says so.
- **The merge is performed with `REGEN_TOKEN`, a real identity, so it *does*
  trigger workflows.** The push to `main` matches `regenerate`'s own `skills/**`
  path filter, so one extra run follows every regeneration and stops at "tree
  already current"; `validate` also re-runs on `main`. A wasted minute per bump,
  and the price of not pushing as the bot.
- **An open regeneration PR does not heal itself.** A PR left open by an earlier
  failure waits for the next `regenerate` run — triggered by the next
  catalog-touching push to `main`, or by `gh workflow run regenerate.yml`.
- **`delete_branch_on_merge` removes the branch**, and the next regeneration
  recreates it. The long-lived-branch reasoning in the job is unaffected: it is
  about not stacking PRs within one open cycle.
- **The test suite moved into `scripts/run-tests.sh`**, because `validate` and
  `regenerate` both run it and the two copies had already diverged — one carried the
  empty-glob guard, the other passed silently on nothing. One copy, one guard, and
  `CLAUDE.md` documents the same command a human runs.
