---
status: accepted
---

# orca-agent-view is a vendored mod, rebuilt from Orca's source

Orca loads its Claude Code mod `orca-agent-view` with `--plugin-dir`, or
`CLAUDE_CODE_PLUGIN_DIRS`, from a folder it writes at runtime. A managed policy
with `disableSideloadFlags` rejects both, and `strictKnownMarketplaces` admits
this marketplace, so serving the mod from here brings Orca's subagent
navigation back on such machines.

An external entry cannot carry it: Orca has no plugin folder to pin.
`agent-view-plugin.ts` builds the files from TypeScript, and `register.js` is a
template that interpolates `parseAgentHookEndpointFile.toString()` and
`CLAUDE_AGENT_VIEW_PATH`. So this is the first local plugin holding third-party
code.

## Decision

- `plugins/orca-agent-view` is a local plugin. `hooks/` holds Orca's files
  unmodified, with Orca's MIT `LICENSE` beside them. Only the manifest's `version`
  and `description` are ours (the description must match the catalog).
- `scripts/sync-orca-agent-view.js` rebuilds `hooks/` from a checkout of Orca
  by reading the TypeScript as text, never running it. It resolves the two
  known interpolations, strips the parser's types with Node's
  `stripTypeScriptTypes`, and fails on any other interpolation, a renamed
  plugin or command, or a changed file set. A loud failure costs a stale copy;
  guessing would ship a `register.js` that differs from Orca's.
- `orca-agent-view-sync.yml` runs it daily against the latest `vX.Y.Z` tag and
  opens a PR only on a diff. That PR is not auto-merged, unlike `regenerate`'s:
  its diff is third-party code that runs inside Claude Code.
- Orca keeps `version: "0.2.0"` across content changes, because its install path
  hashes the content. A changed file therefore bumps our patch, or takes Orca's
  version once Orca's is higher (`nextVersion`). Without a bump, `/plugin update`
  would never deliver the change.
- Like any mod, it is Claude-only (ADR-0034).

## Considered options

- **Renovate on Orca's tags.** Rejected: Orca tags almost daily and the mod
  rarely changes, so most PRs would carry no change to the plugin. Renovate
  also cannot regenerate files.
- **Bundle Orca's generator with esbuild, or run `orca-ide serve`, in CI.**
  Rejected: both execute third-party code to produce three files. The compiled
  `toString()` would also vary with the bundler.
- **Copy the files from a running Orca.** Kept as the one-off check that the
  first copy matched (`hooks/register.js` matches v1.4.263's template outside
  the compiled parser). It cannot run in CI.
