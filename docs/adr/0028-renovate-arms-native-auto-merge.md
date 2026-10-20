---
status: accepted
---

# Renovate arms GitHub's auto-merge, with no hourly PR limit

`renovate.json` had `platformAutomerge: false` (set in #14, no reason recorded)
and inherited Renovate's default `prHourlyLimit: 2`. On the hosted app, which
runs this repo every three to five hours, that made the catalog crawl:

- **Merges waited a run.** With Renovate's own automerge, a PR is merged on a
  *later* run that sees its checks green. #446, #447, #451 and #454 each merged
  3.5–5 hours after opening, though `validate` takes minutes; #466 and #467,
  opened 2026-10-19 20:46, sat green for over ten hours.
- **Two PRs per run.** The hourly limit counts PRs created in a run's hour, and
  with runs hours apart it became two per run. `pbakaus/impeccable
  skill-v4.7.0` was rate-limited on the Dependency Dashboard behind those two.

## Decision

`platformAutomerge: true` and `prHourlyLimit: 0`. Renovate arms GitHub's native
auto-merge when it opens an `automerge` PR, so the merge lands as soon as
`validate` — the one check `main` requires — passes, without waiting for a run.
New PRs are bounded by `prConcurrentLimit` (default 10 open), not by the hour.
Which updates automerge is unchanged: digests and `minor`/`patch` tags, never a
major (ADR-0011).

## Why it is safe here

- The repo allows auto-merge, and branch protection requires `validate`, so an
  armed PR cannot merge red.
- Branch protection is not strict (no up-to-date requirement), so an armed PR
  does not wait on a rebase — the same as Renovate's own merges did.
- Bursts of merges coalesce downstream: `regenerate` runs in one concurrency
  group with `cancel-in-progress`, force-pushing one long-lived branch.
- A red `validate` leaves the PR open with auto-merge armed. ADR-0011 rejected
  arming for the regeneration PR because that failure is quiet; here it was
  equally quiet before — Renovate's own automerge also just left the PR open —
  and the Dependency Dashboard lists it either way.
