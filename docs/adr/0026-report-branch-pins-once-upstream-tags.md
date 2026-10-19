---
status: accepted
---

# Report branch pins once upstream tags

An entry pins a release tag whenever its repo publishes semver tags; `main` or
`master` is for repos that publish none (`/add-external-skill`, *Pinning the
`ref`*). That rule was applied only when an entry was added. `Leonxlnx/taste-skill`
published its first release on 2026-10-13 and its entries stayed on `main` for six
days, Renovate proposing a `sha` bump per commit, until a human asked why.

## Decision

`scripts/check-branch-pins.js` lists every repo whose entries pin `main`/`master`
and whose latest release tag of a series is at or past the pinned `sha`, or on a
diverged history. The tag shape is read from the tag manager's
`versioningTemplate` in `renovate.json`, so the two cannot drift. A tag behind
the pin is listed as a note, not a finding: switching to it downgrades, and the
next release will be ahead of the pin.

The `whole-sources` workflow runs it as a second matrix leg, with the same
issue-keeping as [ADR-0024](0024-report-uncatalogued-skills-of-whole-sources.md):
one issue open while the list is non-empty. The switch itself stays a human edit
through `/add-external-skill update`, whose update mode now names this case.

## Considered options

- **Switch automatically in the regeneration PR.** The `ref` moves the entry to
  another Renovate manager, and every entry of the repo moves at once; both are
  catalog decisions, not a generator's, and a self-merging PR would make them.
- **A rule in the skill alone.** It fires only when someone runs update mode,
  which is what let taste-skill sit on `main`.
- **Its own workflow.** Would copy the issue-keeping script, which already drifted
  once when it lived in two places (`scripts/run-tests.sh` records the same lesson).

## Consequences

- `hashicorp/agent-skills` is only a note today: its only tag, `v1.0.0`, is
  behind the pin. Its next release will be a finding.
- One more GitHub API call per tag series and per branch-pinned repo, under the
  workflow's token. Both checks share `scripts/github.js` for those calls.
