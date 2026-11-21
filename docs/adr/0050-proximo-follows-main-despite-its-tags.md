---
status: accepted
---

# proximo follows `main` despite its tags

Amends [ADR-0026](0026-report-branch-pins-once-upstream-tags.md) for one entry.

`filippolmt/proximo` publishes semver tags, so the default rule would pin a tag.
Its skill is written in the same repo as the tool and changes between releases;
the owner wants each commit to reach the marketplace without waiting for a tag.

## Decision

The `proximo` entry pins `ref: "main"`. Renovate's `git-refs` manager bumps its
`sha` to each new commit, and the `git-refs` packageRule automerges it.

`check-branch-pins.js` would report the pin on every run, because proximo's tags
are at or past it. A `packageRules` entry for `filippolmt/proximo` with
`"allowedVersions": "!/.*/"` excludes every tag from the audit through the
`allowedTag` filter of [ADR-0040](0040-exclude-a-retired-tag-series-with-allowed-versions.md).
The rule is inert for Renovate: it matches the `github-tags` datasource, and no
entry pins proximo to a tag.

## Considered options

- **Keep the tag.** Skill fixes wait for a proximo release.
- **An exemption list inside `check-branch-pins.js`.** A second mechanism for what
  `allowedVersions` already expresses.

## Consequences

- Moving proximo back to a tag requires removing the rule in the same change,
  or Renovate never proposes a tag update for it, silently.
- `check-renovate.js` keeps the rule honest: it fails if no entry pins proximo.
