---
status: accepted
---

# A prune that empties a source drops its records

Amends [ADR-0015](0015-an-upstream-removal-is-pruned-at-regeneration.md) and
[ADR-0014](0014-each-source-repo-is-whole-or-curated.md).

`Jeffallan/claude-skills` v0.5.x moved every skill from `skills/` to
`plugin/skills/`. Regeneration pruned all ten entries, as ADR-0015 says it should.
But the repo's ADR-0014 row and curation baseline stayed behind, and
`check-whole-sources.js --classified` fails on a curated source with no entry. The
regeneration PR stayed red (#819), and the catalog stopped advancing.

## Decision

When a prune leaves a source repo with no catalog entry, the same regeneration
also drops:

- its ADR-0014 rows: the Source repos row and every exclusion;
- its `groups` record and its `curationBaseline` in `scripts/catalog-meta.json`.

That way the regeneration PR passes `validate` and merges itself, as ADR-0011
intends. The reasons in the dropped rows stay in git history, the same as for a
stale exclusion. `descriptionReviewed` is keyed by entry name, and the check that
reads it skips names that are not in the catalog, so nothing removes those keys.

## Considered options

- **Leave the records and fail.** A person has to fix it by hand, and every other
  bump waits until they do. This is the state ADR-0015 removed for entries.
- **Make `--classified` tolerate a curated source with no entry.** The rule exists
  so that a stale row cannot quietly mean nothing.

## Consequences

- A rename upstream still looks like a deletion. If every entry from a repo moves
  together, the whole source leaves the catalog. To bring it back, use
  `/add-external-skill`, which classifies the repo again.
