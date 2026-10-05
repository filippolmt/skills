---
status: accepted
---

# Offer a core Matt Pocock bundle

The catalog installs skills independently. Targeted bundles make one
orchestrator usable, but the workflows commonly used together still require
several separate installs.

## Decision

Add `matt-pocock-bundle` as the all-in-one install for the core workflows:
`wayfinder`, `writing-for-agents`, `implement`,
`improve-codebase-architecture`, `code-review`, and `retro`.

The bundle also installs their complete runtime dependency closure, including
`agent-report-guard` for workflows that spawn sub-agents. Existing targeted
bundles remain compatible for users who prefer smaller installations; new
one-skill bundles are unnecessary when the core bundle already covers the
workflow.
