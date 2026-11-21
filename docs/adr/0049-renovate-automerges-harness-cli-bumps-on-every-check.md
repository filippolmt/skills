---
status: accepted
---

# Renovate automerges harness CLI bumps once every check passes

Amends [ADR-0047](0047-pin-harness-clis-in-ci-and-let-renovate-bump-them.md),
which kept these bumps out of automerge so that a person reads the CI result
before merging. In practice, reading meant opening a PR whose checks were
already green and merging it. The PRs piled up between those visits.

## Decision

A `packageRules` entry automerges the `npm` datasource of `custom.regex`
(the CLIs pinned in workflows) for minor and patch updates, with
`platformAutomerge: false`.

The platform flag is what keeps ADR-0047's guard. With platform automerge,
GitHub merges once the **required** checks pass, and branch protection
requires only `validate`. The pi smoke (`package`, `pi-integration.yml`) and
the Codex smoke (`marketplace`, `codex-integration.yml`) run on path filters,
so they cannot be required: a PR outside their paths would wait forever for a
check that never starts. Renovate's own automerge "only automerge[s] if every
status check has succeeded" (Renovate docs, `ignoreTests`), so a bump that
breaks a smoke stays open, as it did before.

## Considered options

- **Platform automerge, as for the catalog entries.** It is faster, but it
  merges a Codex or pi bump on `validate` alone.
- **Require the smokes in branch protection.** This needs the path filters
  dropped, so every PR would pay for both smokes.

## Consequences

- A merge waits for Renovate's next run after the checks go green, not for
  the moment they go green.
- A major bump still waits for a person.
- A smoke that fails for network reasons (the Codex clone timeout, #438)
  blocks the merge until a re-run, which is the same cost a person pays today.
- A CLI release that makes a check pass more loosely merges unnoticed. A
  person reading a green run would not have noticed either.
