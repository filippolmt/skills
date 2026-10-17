---
status: accepted
---

# Report uncatalogued skills of whole sources in an issue

ADR-0014 says a whole source has every upstream skill catalogued, unless it is a
listed exclusion. Nothing enforced it. Renovate moves each entry's `sha`, and
regeneration prunes a folder upstream deleted (ADR-0015), but a folder upstream
added stays out until someone runs `/add-external-skill update`. On 2026-10-17 an
audit found six: `basin`, `cf-cli`, `gateway-workers`, `k2` and
`workers-profiling` in `cloudflare/skills`, and `taste-skill-v2-experimental` in
`Leonxlnx/taste-skill`. Two vendored `cloudflare` skills already linked to
siblings that were missing.

The same audit found two printing-press exclusion rows in ADR-0014's *Source
repos* table instead of *Catalog exclusions*. Read as data, they overwrote the
repo's kind and hid its exclusions. They were moved; the check's test now parses
the real ADR, so a misplaced row fails it.

## Decision

`scripts/check-whole-sources.js` lists, for every whole source that is not a
whole-plugin entry, the upstream skill folders at the pinned `sha` with neither
an entry nor an exclusion. Mirrors and fixtures are skipped by the rules ADR-0014
gives. The `whole-sources` workflow runs it weekly and on every catalog or
ADR-0014 change on `main`, and keeps **one** issue open with the list, closing it
once the list is empty.

It reads the pinned `sha`, not upstream HEAD: a skill shows up once Renovate has
moved the series past it, which is when an entry could pin it.

## Considered options

- **Open a PR that adds the entries.** Regeneration already merges its own PRs,
  so the plumbing exists. But an entry needs a one-line description written for
  this catalog, and a new upstream skill is sometimes an exclusion (a
  maintainer-only helper, a variant bound to a third-party library). Neither is
  a generator's call, and a self-merging PR would make it anyway.
- **Fail `validate`.** Every Renovate PR that moves a whole source past a new
  skill would turn red for a reason the PR did not cause — the coupling ADR-0010
  rejects.
- **Cover curated sources too.** By ADR-0014 a curated source reports new skills
  without adding them, but without a record of what was already declined the
  report would relist `Jeffallan/claude-skills`'s sixty unpicked skills every
  week. Left to `/add-external-skill update`.

## Consequences

- A new skill in a whole source reaches the catalog the same way as before, by a
  human edit, but no longer waits for someone to think of looking.
- The check calls the GitHub API once per whole source; the workflow passes its
  token to stay clear of the anonymous rate limit.
