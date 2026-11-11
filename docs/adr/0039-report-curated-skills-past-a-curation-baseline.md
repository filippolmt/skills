---
status: accepted
---

# Report curated skills past a curation baseline

Amends [ADR-0024](0024-report-uncatalogued-skills-of-whole-sources.md), which
rejected covering curated sources, and
[ADR-0014](0014-each-source-repo-is-whole-or-curated.md), whose exclusions table
was the only record of a declined skill.

[ADR-0017](0017-curate-the-matt-pocock-source.md) admitted `pr` and
`implement-spec` and said new `mattpocock/skills` skills "are reported for review".
Nothing reported them, and neither landed until #676: `check-whole-sources.js`
looks at whole sources only. Running its whole-source criterion (no entry, no
exclusion) over the curated sources at their pinned `sha` gave 93 findings, almost
all skills deliberately not picked — the noise ADR-0024 predicted.

## Decision

Each curated source has a **curation baseline**: the upstream `sha` up to which a
human has looked through its skills, in `curationBaseline` in
`scripts/catalog-meta.json`, keyed by repo.

`scripts/check-whole-sources.js --curated` reports a skill present at the pinned
`sha` and absent, **at the same path**, at the baseline, minus catalog entries,
ADR-0014 exclusions, mirrors and fixtures. A move counts as new: a skill leaving
`skills/in-progress/` is exactly when it becomes pickable. A curated source whose
entries are all whole-plugin entries is skipped, as in ADR-0024. The
`whole-sources` workflow runs it as its own leg, with its own issue.

Moving the baseline past a skill **is** the decision not to pick it; it needs no
record. An exclusion row stays available for a refusal worth a reason, and the
check honours it.

`/add-external-skill update` moves the baseline to the `sha` it pinned, once the
human has picked. Renovate never moves it: a bump past a new skill is what makes
the report appear.

`--classified`, offline in `validate`, fails on a curated source with no baseline
or no catalog entry, and on a baseline whose repo is not a curated source.
`wshobson/agents` has a baseline too, although the online check skips it: offline
there is no telling a whole-plugin source apart.

The baselines were seeded at each repo's pinned `sha` on 2026-11-11.

## Considered options

- **A baseline inferred from git history** (the last human commit touching the
  repo's entries, as `check-upstream-descriptions.js` does for descriptions). No
  record to keep, but an unrelated human edit silently moves it.
- **List every unpicked skill as an exclusion.** 93 rows of reasons read upstream,
  growing at every release, for a state that is the norm in a curated source.

## Consequences

- A skill admitted by an ADR but present before the baseline is never reported:
  the #676 case would not have been caught. Only additions after the seed are.
- A curated source added by `/add-external-skill` needs a baseline in the same
  change, or `validate` fails.
- The check reads two trees per curated source: the pinned `sha` and the baseline.
