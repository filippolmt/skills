# settings.json best practice

What the docs don't say in one place, or what only shows up by running Claude
Code. An item marked *observed* or *inferred* is not in the docs: re-verify it
before presenting it as fact; unmarked items are documented, or advice.

## Permissions and sandbox

- **`Read(...)` rules in `deny` do not stop Bash.** They govern the Read tool; a
  `cat ~/.ssh/id_ed25519` is stopped only by the sandbox. A list of secrets in
  `deny` with the sandbox off or broken is partial protection: say so.
  (*inferred* from the sandbox's filesystem deny list, which mirrors the `Read`
  rules)
- **Sandbox in an unprivileged Docker container.** bwrap fails with `Can't mount
  proc on /newroot/proc: Operation not permitted` because Docker's masked paths
  cover parts of `/proc`. Probe:
  `bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc true` fails, the
  same line without `--proc /proc` passes. Fix: `sandbox.enableWeakerNestedSandbox:
  true`, weaker than the full sandbox but far stronger than none.
  (*observed* on Docker Desktop, linuxkit kernel)
- **`allowUnsandboxedCommands`.** `true`: a blocked command may leave the
  sandbox, and that retry goes through the permission check. `false`: it fails,
  and every legitimate need (network, sockets, `gh`, `claude plugin install`)
  needs an explicit exception. Ask which friction the user accepts, and set the
  value that matches it.
- **`failIfUnavailable`** blocks startup wherever the sandbox can't start. In
  managed settings, propose it only once the sandbox has been tested on every
  kind of machine in the team.
- **`disableBypassPermissionsMode: "disable"`** is the floor for an organization
  that wants permissions to mean something.

## Plugins and marketplaces

- **`enabledPlugins` in managed settings does not install a plugin's
  `dependencies`.** The bundle is enabled, its dependencies are missing, and
  `Dependency "<name>" is not installed` names them one at a time. List every
  dependency in `enabledPlugins` next to the bundle. Installed with `/plugin
  install`, the bundle does bring its dependencies. (*observed*)
- **`autoUpdate: true` on a third-party marketplace** ships every upstream push
  to everyone unreviewed, including hooks that run every session. For a
  marketplace enforced through managed settings, flag it; the choice stays the
  user's.
- **`strictKnownMarketplaces`** is an allowlist of sources: a marketplace
  declared in `extraKnownMarketplaces` but missing here is refused.
- A plugin enabled in both managed and user settings is a duplicate: propose
  removing it from the user file.

## Managed settings

- **`UNKNOWN` keys.** The schema accepts extra top-level keys, so they pass
  schema validation, but the claude.ai admin console answered one
  (`syncClaudeAiPlugins`) with a generic schema-error warning that named no
  key; removing it cleared the warning. Report every `UNKNOWN` key as a likely
  cause of that warning. Before removing one, check the docs for whether Claude
  Code reads it anyway: without the key the default applies, which can change
  behaviour. (*observed*, for one top-level key)
- **`forceRemoteSettingsRefresh: true`** blocks startup until the settings are
  fetched: right when they act as security policy, but it leaves Claude Code
  unusable without network.
