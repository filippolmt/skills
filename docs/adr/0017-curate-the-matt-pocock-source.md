---
status: accepted
---

# Curate the Matt Pocock source

`mattpocock/skills` is designed as one cohesive upstream plugin, while this
marketplace installs each skill independently. Treating the repo as a whole source
therefore admitted ecosystem-level routers and prompt macros that were not useful
on their own.

The source is now **curated**. Four entries leave the catalog:

- `ask-matt` routes across the whole upstream suite, most of which a user who
  installed only that entry does not have;
- `git-guardrails-claude-code` configures Claude Code only, while this catalog
  also serves pi and Codex;
- `wait-what` is a thin rephrasing prompt rather than a reusable workflow;
- `resolving-merge-conflicts` already has an upstream changeset scheduling its
  removal.

## Additions from v1.3.1

Upstream v1.3.1 contains three skills that were unreleased when this decision was
written. Keep the catalog on the latest semver tag:

- admit `pr` as a standalone entry;
- admit `retro` through the core `matt-pocock-bundle`, which also installs
  `writing-for-agents`;
- admit `implement-spec` only together with an `implement-spec-bundle` that
  installs `setup-matt-pocock-skills`, `tdd`, `code-review`, and
  `agent-report-guard`.

The raw entries remain necessary because bundles name catalog entries as
dependencies. The bundle is what makes each orchestrator a complete install.

## Consequences

- New skills from this source are reported for review instead of entering the
  catalog automatically.
- Existing installations of the four removed entries must be uninstalled or
  installed directly from upstream.
- The generated skills tree drops their vendored copies on the next regeneration.
