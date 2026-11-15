---
status: accepted
---

# Refuse a pinned sha moved off its history

Amends [ADR-0015](0015-an-upstream-removal-is-pruned-at-regeneration.md). That ADR
lets a Renovate PR through when an entry's `path` is gone at its new `sha`, so
regeneration can prune it. This assumes the new `sha` comes *after* the old one:
upstream deleted the skill.

Some moves break that assumption: a retired tag series that outranks the current
one (`microsoft/playwright-cli`'s 2020 tags, [ADR-0040](0040-exclude-a-retired-tag-series-with-allowed-versions.md)),
a force-pushed branch, or a tag series that restarted. Each of these makes the path
vanish too. The PR passes `validate`, automerges, and regeneration prunes a skill
nobody removed.

## Decision

`scripts/check-sha-history.js <base-ref>` reads the catalog at the base. For every
external entry whose `sha` changed in the same repo, it asks GitHub to compare
`<old>...<new>`:

- `ahead` or `identical` passes;
- `behind` or `diverged` fails;
- a 404 means the two shas share no merge base, and it reports that as
  `unrelated`. A `sha` that is missing outright is already caught by
  `--verify-paths`.

`validate` runs it on pull requests against the fetched base branch. `validate` is
a required check, so a failure stops the automerge, and a human then decides with
`/add-external-skill update`. New and removed entries have no move to check.

## Considered options

- **Fail `--verify-paths` on a missing path again.** This is what ADR-0015
  replaced: a genuine upstream removal stayed red and blocked the whole repo.
- **Check only when the path vanishes.** That would miss a force-push that keeps
  the path but rewrites the content. The decision belongs to a human in both cases.

## Consequences

- An upstream force-push on a branch-pinned repo now stops that repo's Renovate
  PR until someone reviews it.
- Every PR spends one GitHub API call per moved repo.
