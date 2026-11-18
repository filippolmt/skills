---
status: accepted
---

# Pin the harness CLIs in CI and let Renovate bump them

CI tests the projections with three harness CLIs, each installed globally with
npm in a workflow: Claude Code (`validate.yml`, `regenerate.yml`), pi
(`pi-integration.yml`) and Codex (`codex-integration.yml`). Claude Code was
installed without a version, so each run tested whatever npm called latest that
minute and recorded nothing: a red run could come from a new CLI release as easily
as from the change under test. pi and Codex were pinned, but nothing bumped them,
so they fell behind with no signal.

## Decision

Every global `npm install` in `.github/workflows/*.yml` names an exact
`<package>@X.Y.Z`. A third `customManager` in `renovate.json`, with
`datasourceTemplate: "npm"`, matches those lines and opens a bump PR per release.
No `packageRules` entry automerges these PRs: a CLI release can change what
`claude plugin validate` or a harness smoke accepts, so a person reads the CI result
before merging.

`cliPinError` in `scripts/check-renovate.js` fails when a global install is
unpinned, or when the number of managers that claim it is zero or more than one.
Zero is the silent case: a pin that no regex reaches stays at its version, and
nothing reports it. More than one opens competing bump PRs. Claims are matched to
installs **by offset**, not counted, for the same reason `coverageError` does it: a
doubly claimed install and an unclaimed one cancel out in a count.

The check reads shell as words split on whitespace and shell separators. It
recognises `-g`, `--global` and `--location=global` in any position, as well as
every npm alias for `install`. It skips comments, and it joins `\` continuations.
A spec that is quoted is read without its quotes. A spec built from a variable is
reported as unpinned, never skipped.

## Considered options

- **Leave Claude Code floating.** CI then catches a breaking Claude Code release
  on the next run. But the run looks like it failed because of the change under
  test, and nothing records which version passed.
- **A version file per CLI, read by the workflows.** That adds an indirection,
  while Renovate can already bump the version in place in the `run:` line.

## Consequences

- An install in a form the check does not read, such as `pnpm add -g` or `npx`,
  goes unchecked. Extend `globalInstalls` when a workflow first uses one.
- A `managerFilePatterns` that is a glob rather than a `/regex/` is reported, since
  the check cannot tell which files it reaches.
