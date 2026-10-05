# settings.json best practice

What the docs don't say in one place, or what only shows up by running Claude
Code. Each item says whether it is documented or observed: re-verify an observed
item before presenting it as fact.

## Permissions and sandbox

- **`Read(...)` rules in `deny` do not stop Bash.** They govern the Read tool; a
  `cat ~/.ssh/id_ed25519` is stopped only by the sandbox. A list of secrets in
  `deny` with the sandbox off or broken is partial protection: say so.
  (inferred from the sandbox's filesystem deny list, which mirrors the `Read`
  rules)
- **Sandbox in an unprivileged Docker container.** bwrap fails with `Can't mount
  proc on /newroot/proc: Operation not permitted` because Docker's masked paths
  cover parts of `/proc`. Probe:
  `bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc true` fails, the
  same line without `--proc /proc` passes. Fix: `sandbox.enableWeakerNestedSandbox:
  true`, weaker than the full sandbox but far stronger than none.
  (observed on Docker Desktop, linuxkit kernel)
- **`allowUnsandboxedCommands`.** `true`: a blocked command may leave the
  sandbox, and that retry goes through the permission check. `false`: it fails,
  and every legitimate need (network, sockets, `gh`, `claude plugin install`)
  needs an explicit exception. Ask which friction the user accepts; don't
  impose `false`.
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
  install`, the bundle does bring its dependencies. (observed)
- **`autoUpdate: true` on a third-party marketplace** ships every upstream push
  to everyone unreviewed, including hooks that run every session. For a
  marketplace enforced through managed settings, flag it; the choice stays the
  user's.
- **`strictKnownMarketplaces`** is an allowlist of sources: a marketplace
  declared in `extraKnownMarketplaces` but missing here is refused.
- **`claude-plugins-official`** is a name reserved for Anthropic's official
  marketplaces (documented), and Claude Code registers it on its own.
- A plugin enabled in both managed and user settings is a duplicate: propose
  removing it from the user file.

## Managed settings

- **Unknown keys in the admin console** produce a generic schema-error warning
  that names no key: `check.py` lists them as `UNKNOWN`. Before removing one,
  check the docs for whether Claude Code reads it anyway: without the key the
  default applies, which can change behaviour.
- **`forceRemoteSettingsRefresh: true`** blocks startup until the settings are
  fetched: right when they act as security policy, but it leaves Claude Code
  unusable without network.
- **Precedence**: managed beats everything, bar a few documented exceptions. A
  key set in the user file to "fix" a managed one has no effect.
