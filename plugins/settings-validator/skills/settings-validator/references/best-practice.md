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
- **A rule covers only what its anchor reaches** (`permissions` § Read and
  Edit). A bare `Read(.env)` matches at any depth below the current directory,
  and no `.env` outside it; a single leading `/` anchors at the settings
  source, not the filesystem root (`//` is the root, `~/` the home). State the
  real coverage of each secret rule in the verdict.
- **Derive the secret list from the tools the team uses.** Read the CLIs named
  in the answers and in the repo (`CLAUDE.md`, Makefile, CI) and check each
  one's credential path is denied: `glab` keeps its token under
  `~/.config/glab-cli/`, as `gh` does under `~/.config/gh/`. A generic list
  misses the ones that matter.
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
- **`auto` posture: propose `autoMode.environment`** with the org's trusted
  repos, hosts and buckets, so the classifier stops blocking routine internal
  operations; keep `"$defaults"` in the array. `autoMode` is read from user or
  managed settings and `useAutoModeDuringPlan` from user, local or managed:
  in a shared project file neither does anything.

## Plugins and marketplaces

- **`enabledPlugins` in managed settings does not install a plugin's
  `dependencies`.** The bundle is enabled, its dependencies are missing, and
  `Dependency "<name>" is not installed` names them one at a time. List every
  dependency in `enabledPlugins` next to the bundle. Installed with `/plugin
  install`, the bundle does bring its dependencies. (*observed*)
- **Cross-check `strictKnownMarketplaces` and `extraKnownMarketplaces` in both
  directions**, and report each source present in only one:
  - declared but not allowed: the marketplace is refused;
  - allowed but not declared in managed settings: it is not registered
    fleet-wide and its auto-update policy is not set centrally.
- **Allowlist entries match exactly** (`plugins/org` § How entries match):
  `repo` or `url`, `ref` and `path` must all be equal, or absent on both sides.
  A `.git` suffix, a trailing slash, or `ssh://` in place of `https://` is a
  different value, and an `owner/repo` entry does not cover a `git` URL of the
  same repository. Compare each declared source with the allowlist character by
  character; for an internal host reached by more than one URL, propose
  `hostPattern`.
- **An allowlist without `disableSideloadFlags` has a hole.**
  `strictKnownMarketplaces` does not block `--plugin-dir`; the managed
  `disableSideloadFlags: true` rejects `--plugin-dir`, `--plugin-url`,
  `--agents` and non-SDK `--mcp-config`. Propose it whenever an allowlist is
  set. Its cost: plugin authors lose `--plugin-dir` for local development. The
  user decides.
- **Auto-update is off by default for a private or third-party marketplace**
  (`plugins/loading` § Which marketplaces and plugins auto-update). It is on
  only for Anthropic's official marketplaces, such as
  `claude-plugins-official`, and for marketplaces added from claude.ai; even
  Anthropic's `knowledge-work-plugins` and `first-party-plugins` start off.
  To decide it for the fleet, set `autoUpdate` on the
  managed `extraKnownMarketplaces` entry: a managed value locks the user's
  `/plugin` toggle, an unset one leaves it to the user (`plugins/org` § Turn
  auto-update on or off per marketplace). A managed entry replaces a same-name
  project entry; their fields are not merged (`plugins/org` § Require a
  marketplace and its plugins).
- **`autoUpdate: true` on a third-party marketplace** ships every upstream push
  to everyone unreviewed, including hooks that run every session. For a
  marketplace enforced through managed settings, flag it; the choice stays the
  user's.
- **What users should expect from auto-update.** It runs in the background, up
  to ten minutes after the first message; the running session keeps the old
  version until `/reload-plugins`, and the next launch loads the new one.
- **Private git marketplaces update only with non-interactive credentials**
  (`plugins/host-marketplace` § What background auto-update does with
  credentials, § Grant access to a private marketplace). SSH needs a key that
  works without a passphrase prompt, such as one loaded in `ssh-agent`, and
  the host already in `known_hosts`; HTTPS needs a credential helper that
  answers without prompting. A provider token in the environment does nothing
  without a helper that reads it. A failed check stays quiet;
  `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1` skips the re-clone it
  triggers. Give the user the unattended-update probe in
  [`verify-managed.md`](verify-managed.md) for each kind of machine.
- A plugin enabled in both managed and user settings is a duplicate: propose
  removing it from the user file.

## `UNKNOWN` keys

They pass schema validation, since the top level accepts any key. Weigh each
by its `check.py` tag:

- `(documented)`: the schema lags behind the docs. Report it as informational,
  with the Claude Code version the reference requires.
- `(undocumented)`: likely a typo, a removed key, or one Claude Code never
  reads. Report it as a warning.

**Managed: the admin console's schema warning.** The claude.ai admin console
answered the undocumented `syncClaudeAiPlugins` with a generic schema-error
warning that named no key, and removing it cleared the warning; it accepted
the documented `disableCommandPluginSources` with no warning. Both are absent
from the schema. Treat the documented key as informational and the
undocumented key as a likely cause of the console warning. Before removing an
undocumented key, check whether Claude Code reads it anyway: without the key
the default applies, which can change behaviour. (*observed*, one key each
way)

## Managed settings

- **Only one managed source applies by default** (`managed-settings` § How
  Claude Code combines managed sources): the highest-ranked of server-managed,
  MDM and `managed-settings.json` that delivers a policy key, and the others
  are ignored without a warning. The exception is the keys in § Keys read from
  every admin source (sandbox locks, `forceRemoteSettingsRefresh`, `env` per
  variable, and a few more), which a lower source can still set.
  `managedSourcesBehavior: "merge"` combines every source instead. Name in the
  verdict which sources the delivered file overrides, and which keys those
  sources can still set.
- **`forceRemoteSettingsRefresh: true`** blocks startup until the settings are
  fetched: right when they act as security policy, but it leaves Claude Code
  unusable without network. It acts only on server-managed settings.

## Secondary-source errata

Where `best-practice/claude-settings.md` disagrees with the official docs
(checked against its 2026-09-01 commit). Report each one the file still carries.

- `strictKnownMarketplaces`: given as a `boolean` that allows only the official
  marketplace. Officially an array of marketplace sources, and `[]` blocks
  every source, the official marketplace included.
- `extraKnownMarketplaces`: given scope "Project". Officially "Any file";
  managed is how to apply it fleet-wide.
