---
status: accepted
---

# Project native Codex plugins from the catalog

Codex now supports Git-backed marketplaces and native plugins containing skills,
MCP configuration and lifecycle hooks. The loose skills tree chosen by
[ADR-0010](0010-vendor-a-shared-skills-tree-on-main.md) therefore no longer gives
Codex first-class parity with Claude Code. We will keep the Claude marketplace
catalog as the canonical inventory and source pin, generate a self-contained
Codex plugin for each supported catalog entry, and keep the root skills tree as
pi's loose-skill projection.

This ADR replaces only ADR-0010's Codex distribution decision. Its decisions for
pi, vendoring, licences, overlays, the default branch and the regeneration PR
remain in force. [ADR-0007](0007-vendor-a-generated-codex-catalog.md) remains
historical and superseded.

## What was decided

**The catalog remains the source of truth.** Only
`.claude-plugin/marketplace.json` can introduce or remove an entry. A minimal
`scripts/distribution-meta.json` records only facts that cannot be derived:
runtime dependency edges, adaptations, unsupported dispositions, fallbacks and
presentation overrides. Metadata cannot create entries or artifacts. Orphaned
metadata, an unclassified artifact, or a generated package without a catalog
entry is an error.

**Parity is measured per artifact, while Codex installation identity remains per
catalog entry.** Generation inventories every skill, command, agent, hook, MCP
configuration and other distribution-relevant artifact under each entry's source.
Each artifact receives exactly one Codex disposition and one pi disposition:
`native`, `adapted`, or `unsupported`. Unsupported means the exact limitation and
best fallback are recorded; a manual workaround is not called parity. The
human-readable parity matrix is generated from this same inventory and metadata,
never maintained separately.

**Codex gets a repo-scoped native marketplace.** The generated catalog lives at
`.agents/plugins/marketplace.json`; self-contained packages live under
`.agents/plugins/packages/<entry>/`. There is one Codex marketplace entry and one
package per supported Claude catalog entry, including entries that contain several
skills or converted artifacts. Unsupported entries appear in the parity matrix,
not as misleading installable stubs.

**Packages use the portable Agent Plugins layout.** Each package has root
`plugin.json`, root `skills/`, optional root `mcp.json`, and optional lifecycle
hooks. OpenAI-specific settings live under `extensions.com.openai`; the
`.codex-plugin/plugin.json` compatibility layout is not the source format. Package
versions combine source identity with a fingerprint of the complete generated
package, and a black-box Codex test must prove that any content change refreshes an
installed plugin before the exact version scheme is fixed.

**Every package materialises its runtime closure.** A package must work in a fresh
Codex session, so this applies to individual entries as well as bundles. For
example, the `grill-with-docs` package includes the `grilling` and
`domain-modeling` skills it calls. Dependency edges that cannot be derived safely
are declared in distribution metadata; generation does not guess them from prose.
Claude bundles become self-contained Codex packages containing their complete
behavioral closure. A Claude-only guard is classified as not applicable rather
than copied merely because it appears in `dependencies`.

**Portable conversions are generated once for Codex and pi.** Existing skills keep
their names. Reusable Claude commands and agent procedures become deterministic,
namespaced skills such as `impeccable-polish` or
`api-scaffolding-backend-architect`, with collisions rejected. Structural
conversion is code; provider-specific content edits remain overlays that fail when
they no longer apply. Converted portable skills enter both the root skills tree and
the owning Codex package. Their licence and `SOURCE.md` identify the original
artifact, path, transformation and catalog entry.

**Equivalent schemas are not enough for hooks.** A hook is adapted only when the
same runtime condition exists and an end-to-end test proves the behavior. Codex
support for `PreToolUse` does not by itself make a Claude guard portable:
`agent-report-guard` addresses Claude mailbox semantics, while
`zsh-wordsplit-guard` would be wrong under a shell that performs word splitting.
Installed Codex hooks are considered functional when Codex discovers them,
requests trust, and they pass after the user approves them. The trust step and any
surface limitation are documented.

**MCP is preserved where Codex CLI can run it.** Portable remote endpoints remain
remote; supported local servers remain local when their executables ship with the
package. Generation does not silently deploy a local server or pretend that a
Claude declaration works in Codex. Codex CLI local is the required and tested
surface. ChatGPT desktop and Work are best effort because cloud execution cannot
run every local hook, executable or MCP server.

**Pi keeps the loose-skill projection.** Root `skills/` remains pi's package
convention directory and receives every native or adapted portable skill. Bundle
closures produce generated pi package-filter snippets; hooks and other
unrepresentable behavior receive explicit limitations. The `.agents/skills`
symlink is removed when the native Codex marketplace lands, because loading both
loose skills and installed plugin copies creates duplicate identities. Older Codex
versions can use the root tree only through an explicitly documented manual
fallback; they are not a second active distribution.

**One regeneration pipeline writes both projections.** Upstream checkout, licence
checking, artifact discovery, pruning and overlay application are shared. Separate
writers materialise root `skills/`, the Codex marketplace and packages, pi filter
snippets, and `docs/distribution-parity.md`. Generated Codex packages contain real
copies rather than symlinks escaping the package root, because Codex installs a
package into its own cache. Duplication generated from one inventory is acceptable;
a second hand-maintained copy is not.

**Missing decisions fail before merge.** Pull-request validation resolves every
source at its pinned SHA and inventories its artifacts, including on Renovate SHA
bumps. A new artifact, unknown manifest feature, missing disposition, unresolved
closure or collision turns the PR red. The post-merge regeneration PR performs
only deterministic materialisation and pruning; it never invents a fallback.
Removal also removes generated packages and updates the parity matrix, while the
README tells users how to remove stale installed Codex copies.

**Testing follows the package shapes.** Fast tests cover inventory, closure,
conversion, rendering, collision detection and fingerprints. Every generated file
is validated. A path-filtered integration job installs a pinned minimum Codex CLI
into an isolated home, registers the local marketplace, and exercises a simple
skills-only package, a multi-artifact package, a bundle, each adaptation class and
hook trust/behavior. Complete static coverage applies to every entry; repetitive
model invocation for every unchanged skills-only package does not.

## Considered and rejected

- **Keep Codex on `.agents/skills`.** It loses plugin identity, bundles, hooks and
  MCP, and current Codex no longer requires that compromise.
- **Replace the Claude catalog with a neutral catalog.** It enlarges the migration
  and risks the working Claude distribution. A constrained sidecar records only
  irreducible cross-harness facts without becoming another inventory.
- **Generate `.codex-plugin/plugin.json`.** It is a supported compatibility
  fallback, but root `plugin.json` is the portable format and better matches a
  three-harness repository.
- **Reference upstream folders directly.** Most sources are bare skills or Claude
  plugins rather than portable Codex packages, and unresolved Git entries are
  skipped. Self-contained generated packages make failures and adaptations ours to
  validate.
- **Keep `.agents/skills` beside native plugins.** Installing a projected plugin in
  this checkout would expose the same workflow through two discovery paths.
- **Create unsupported placeholder plugins.** They are installable promises that
  cannot perform the workflow. The generated parity matrix is the honest surface.
- **Infer runtime dependencies from prose.** Natural-language matching is not a
  dependable package graph; explicit exceptional edges are smaller and auditable.
- **Run Codex against every package in every test.** Static completeness plus
  black-box coverage of every package shape catches generator defects without
  repeating the same expensive path for dozens of plain skills.

## Consequences

- Codex users migrate from ambient loose skills to explicit marketplace installs.
- The checked-in generated footprint grows because package caches cannot rely on
  symlinks outside each package.
- A catalog or upstream change can now fail because it introduces an unclassified
  capability; that failure is the intended parity guard.
- Bundle and individual plugins may contain overlapping skills. Their coexistence
  is supported only if black-box tests prove Codex namespaces them safely;
  otherwise documentation must make them alternatives.
- `codex plugin marketplace upgrade`, plugin refresh/removal, hook trust, and the
  minimum tested Codex version become part of the installation contract and must
  be documented from observed CLI behavior.
- New catalog entries receive Claude behavior as before, plus an explicit Codex
  and pi outcome before they can merge.
