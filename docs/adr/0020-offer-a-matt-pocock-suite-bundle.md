---
status: accepted
---

# Consolidate Matt Pocock bundles

The catalog installs skills independently. Six targeted bundles made individual
orchestrators complete, but the workflows commonly used together still required
several separate installs and left users choosing among overlapping bundles.

## Decision

Use one `matt-pocock-bundle` for the core workflows: `wayfinder`,
`writing-for-agents`, `implement`, `improve-codebase-architecture`, `code-review`,
and `retro`.

The bundle installs their complete runtime dependency closure, including
`agent-report-guard` for workflows that spawn sub-agents. Remove the six targeted
Matt Pocock bundles; every underlying skill remains available as an independent
catalog entry for smaller installations.

## Migration

Existing installations of `improve-codebase-architecture-bundle`,
`code-review-bundle`, `implement-bundle`, `triage-bundle`, `wayfinder-bundle`, or
`grill-with-docs-bundle` must uninstall the old bundle and install either
`matt-pocock-bundle` or the desired individual skills.
