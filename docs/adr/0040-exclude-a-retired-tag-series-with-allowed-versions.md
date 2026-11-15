---
status: accepted
---

# Exclude a retired tag series with `allowedVersions`

Amends [ADR-0026](0026-report-branch-pins-once-upstream-tags.md): the latest
release tag that `check-branch-pins.js` and `check-upstream-versions.js` compare
against now excludes the tags Renovate excludes.

`microsoft/playwright-cli` publishes its skill under `v0.0.x`/`v0.1.x` tags (from
2026). It also keeps 14 tags from a retired 2020 project: `v0.4.3` to `v0.5.2` and
`v0.150.0` to `v0.180.0`. Those tags contain no `skills/` folder. Renovate's tag
manager compares versions with a regex, so `v0.180.0` outranks `v0.1.24`, counts as
a minor update, and the github-tags rule automerges it. The skill disappears, and
nothing reports it.

## Decision

Pin the tag and add a `packageRules` entry for that one package. Its
`allowedVersions` is a negated regex listing the retired tags **exactly**:

```json
"allowedVersions": "!/^v0\\.(4\\.[34]|5\\.[0-2]|15[0-2]\\.0|16[12]\\.0|162\\.1|17[01]\\.0|180\\.0)$/"
```

The retired set is closed: those tags will not move. A per-series pattern such as
`!/^v0\.(4|5|1[5-8]\d)\./` would also block a legitimate future `v0.4.5` or
`v0.5.3`.

Two guards keep the rule from failing silently:

- `scripts/check-renovate.js` fails when a `matchPackageNames` names a package
  that no external entry pins. Renaming the source in the catalog would otherwise
  leave the rule matching nothing.
- `allowedTag` in `scripts/check-branch-pins.js` filters tags through the same
  `allowedVersions` before `check-branch-pins.js` and `check-upstream-versions.js`
  pick the latest tag in a series. Without it, the audit would report the entry
  stale against `v0.180.0` forever. It reads only the `/re/` and `!/re/` forms and
  throws on any other form, rather than skip it.

The same applies to any future source with a tag series it has abandoned.

## Considered options

- **Branch pin (`main`).** Leaves the Renovate seam untouched, but follows
  unreleased commits even though upstream publishes releases.
- **A prefix series.** The repo has no prefix that tells the two projects apart.

## Consequences

- A new tag that upstream adds to a retired series is admitted. That is
  deliberate, see above. It includes a hypothetical `v0.181.0`, which would again
  outrank `v0.1.x`: the regex then needs that tag added.
- Every `allowedVersions` in `renovate.json` must be a regex, or the audit fails.
