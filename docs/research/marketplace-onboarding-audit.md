# Marketplace onboarding audit

**Remediated:** The documentation corrections and recommendations below have been
applied on `feat/repository-audit`, including the GitHub description. The text
below records the original audit; “not applied” refers to that audit phase.
Both minimum-version installation smokes subsequently passed; see
[remediation results](repository-audit.md#remediation).

Checked 2026-10-25 against repository commit `ae3d8841f177fac25548798e808a4ad54dcc36e8`, current official documentation, and installed pi `1.4.0` / Codex CLI `0.164.0`.

## Scope

Public onboarding in [README.md](../../README.md), the GitHub repository description, and the implementation behind the advertised distribution paths. Read [CLAUDE.md](../../CLAUDE.md) and [GLOSSARY.md](../../GLOSSARY.md); terminology below follows their catalog, bundle, runtime closure, and package-filter definitions. This is a documentation audit, not a new distribution design.

The three distribution routes are real and different: Claude installs catalog references, Codex installs generated self-contained native plugins, and pi installs one repository package with selectable skills. Preserve that distinction rather than replacing everything with loose-skill installation instructions.

## Concrete mistakes

### 1. A pi checkout does not automatically expose root `skills/`

**Location:** README, “The tree: how pi gets these skills”, table row “pi inside a checkout … nothing”.

A package's convention directory is not a working-directory discovery location. Pi discovers project skills under `.pi/skills/` and `.agents/skills/`; root `skills/` is discovered when that directory is explicitly loaded as a package. The repository has neither a `.pi/settings.json` declaration nor the former `.agents/skills` symlink. Official configuration/package docs and `PackageManager.addAutoDiscoveredResources` agree on this distinction. [P1–P4]

**Reproduction:** with temporary empty `PI_CODING_AGENT_DIR` and `PI_PACKAGE_DIR`, from this checkout, queried `get_commands` over RPC with `--no-session --no-tools --no-context-files --approve --offline`. There was no `skill:tdd`. Adding `--skill "$PWD/skills/tdd"` exposed it. No model request or package installation was needed.

**Smallest correction:** replace “nothing” with an explicit checkout command, for example `pi -e .`, run from the repository root. For persistent project configuration, the equivalent package source is `".."` in `.pi/settings.json`, because local paths resolve relative to that settings file. Do not restore the shared-location symlink: its deliberate absence prevents duplicate Codex identities. [P1–P3]

### 2. Bash is not universally zsh

**Locations:** README, “Bash commands under zsh need …”, first sentence; generated `zsh-wordsplit-guard` catalog description.

“The Bash tool runs zsh” overgeneralizes the author's environment. Claude's official `CLAUDE_CODE_SHELL` documentation accepts bash or zsh and says auto-detection uses `$SHELL` when it names either supported shell. [C1]

**Smallest correction:** “When Claude Code's Bash tool runs zsh, parameter expansion is not word-split.” Qualify the generated description in its catalog source too, then regenerate; do not hand-edit the catalog projection. The existing closing instruction, “install it if your Bash commands run under zsh”, already has the right scope. This finding does not establish whether every guard rule is safe under bash.

### 3. The external-source requirement contradicts whole-plugin entries

**Location:** README, final sentence of “External skills”: “The folder pointed to by `path` must be a valid skill (contain `SKILL.md`).”

That is true only of per-skill entries. The same section correctly describes whole-plugin entries, whose `path` points at a plugin root instead. The catalog's `diagram-design` uses `"path": "."`; its actual skill is nested. [R1–R2] Official Claude marketplace docs describe `git-subdir.path` as the plugin's subdirectory, not an unconditional root-level `SKILL.md` requirement. [C2]

**Smallest correction:** “For a per-skill entry, `path` contains `SKILL.md`; for a whole-plugin entry, it points at the plugin root containing `.claude-plugin/plugin.json`.” Keep the repo-root `"."` convention from ADR-0008.

## Onboarding gaps, not invalid commands

### Make the Claude-only sections explicit

“Adding this marketplace”, the first installation examples, the bundle table, and the guard instructions use Claude commands but follow an introduction naming three harnesses. “Each skill is its own plugin” also needs “By default”: whole-plugin entries and bundles are intentional exceptions. [R1–R2]

**Minimal recommendation:** label the first route “Claude Code”, qualify examples as `/plugin install tdd@filippo-skills`, and add one sentence to review the plugin, choose a scope, and confirm in the panel. Current official docs say interactive `/plugin install` opens details rather than immediately installing. Namespacing such as `/tdd:tdd` is correct. [C2–C4]

### Explain Claude refresh, activation, and opt-in auto-update

The README gives `/plugin marketplace update filippo-skills` without explaining activation or auto-update defaults. Current official docs say the interactive marketplace update action refreshes the listing **and updates installed plugins**. Therefore it would be incorrect to categorically report that this slash command only updates metadata. The shell marketplace-refresh command and the installed-plugin update command remain distinct. [C3–C4]

**Minimal recommendation:** retain the slash command, add “Start a new session or run `/reload-plugins` to load updated content”, and mention that third-party marketplace auto-update is off by default and can be enabled in `/plugin` → Marketplaces. For an explicit single-plugin shell update, show `claude plugin update tdd@filippo-skills`. Do not promise Renovate alone refreshes users' installed copies. [C3–C4]

### Finish the Codex and pi paths with an invocation check

The Codex commands are supported by installed CLI help and mirrored in [the repository lifecycle smoke](../../scripts/test-codex-marketplace.sh): marketplace registration, listing, `plugin add`, snapshot upgrade, and removal. The official packaging docs also document Git marketplace registration and upgrade. There is no evidence here that the native-plugin route should be replaced with `$skill-installer` or a `.agents/skills` symlink. [O1–O2]

However, unlike the Claude route, neither route ends with a clearly labelled manual invocation:

- **Codex:** open `/skills` or type `$` and select the installed skill; the official docs distinguish explicit selection from description-based implicit invocation. Avoid guessing an ambiguous skill identity when a component and bundle coexist. [O3]
- **pi:** run `/skill:tdd`; the official docs recommend explicit invocation when the model fails to load a relevant skill. Existing package/filter snippets, `/reload`, and global/project picker instructions should remain. [P1–P3]

The Codex upgrade smoke verifies snapshot success and that `tdd` remains installed/enabled; it does **not** change a skill between two revisions and prove updated behavior was loaded. The README currently limits its claim to an observation with `0.160.1`, so this is a test limitation, not a demonstrated false statement. Keep that qualification and the new-session advice. Generated plugin versions incorporate source/content fingerprints in [gen-codex.js](../../scripts/gen-codex.js); do not simplify away that update mechanism. [R3]

## GitHub description

Read with `gh repo view --json nameWithOwner,description,url,defaultBranchRef`; repository is `filippolmt/skills`, default branch `main`. Observed description:

> Skill marketplace for Claude Code, pi and Codex — install one skill per plugin, or read the vendored tree. External skills referenced upstream via git-subdir, auto-updated by Renovate.

It correctly names all three harnesses, but “one skill per plugin” hides the whole-plugin/bundle exceptions and “or read the vendored tree” hides Codex's native packages and pi's package filters. “Referenced upstream” applies to Claude; pi/Codex receive copies. These are positioning inaccuracies, not a broken GitHub setting. [R1–R3]

**Suggested replacement, not applied:**

> Skills for Claude Code, Codex CLI and pi: install individual plugins or workflow bundles; pi uses one package with skill filters. Upstream updates via Renovate.

## Minimal recommendation set

1. Fix the three concrete mistakes above; preserve generated-region ownership.
2. Add a compact harness chooser near the top: Claude catalog/plugins; Codex native marketplace/plugins; pi one package with filters. Link to the existing detailed sections rather than duplicating JSON.
3. Add installation confirmation/activation guidance for Claude and one explicit invocation check for Codex and pi.
4. Optionally shorten the repository description to the proposed copy.

Keep the existing parity-matrix and pi-filter links, unsupported-workflow warnings, ref-less pi source, and explicit package-update command. Pi's documented `pi update --extensions` updates packages, whereas bare `pi update` updates Pi itself. The installed implementation also confirms `autoload: false` resource selection; it is not an invented setting to remove. [P1–P4]

## Primary sources

### Claude Code

- **C1:** [Environment variables — `CLAUDE_CODE_SHELL`](https://code.claude.com/docs/en/env-vars).
- **C2:** [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces), especially plugin sources and entry-name versus manifest-name behavior.
- **C3:** [Install and manage plugins](https://code.claude.com/docs/en/discover-plugins), especially installation confirmation and “Keep plugins updated”.
- **C4:** [Plugin commands reference](https://code.claude.com/docs/en/plugins/cli-reference), especially qualified IDs, `plugin update`, marketplace refresh, and interactive commands.

### pi

The installed package is `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent`, version `1.4.0`. Read its README and relevant `docs/packages.md`, `skills.md`, `settings.md`, `cli.md`, `configuration.md`, and `security.md` completely, plus the examples index. Public versioned counterparts:

- **P1:** [Pi packages](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/packages.md): package convention directories, local-path resolution, filters, and project trust.
- **P2:** [Skills](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/skills.md) and [configuration](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/configuration.md): discovery locations, explicit invocation, and reload.
- **P3:** [CLI package commands](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/cli.md#package-commands) and [settings](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/settings.md): update targets and resource settings.
- **P4:** [Package manager implementation](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/package-manager.ts): `addAutoDiscoveredResources`, `collectPackageResources`, and `collectAncestorAgentsSkillDirs`; inspected the installed compiled equivalents directly. [Security/project trust](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/security.md).

### OpenAI / Codex

- **O1:** [Package your plugin](https://developers.openai.com/plugins/build/plugins), especially marketplace registration/upgrade and native marketplace layout.
- **O2:** Installed `codex plugin --help` and `codex plugin marketplace --help` (`0.164.0`); [official CLI plugin tests at that version](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/cli/tests/plugin_cli.rs) and [marketplace upgrade implementation](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core-plugins/src/marketplace_upgrade.rs).
- **O3:** [Official skill documentation](https://developers.openai.com/codex/skills), currently served as “Build skills”: `/skills`/`$` explicit invocation, implicit invocation, and loose-skill discovery locations.

### Repository implementation

- **R1:** [Claude catalog](../../.claude-plugin/marketplace.json), [Codex marketplace](../../.agents/plugins/marketplace.json), and [domain glossary](../../GLOSSARY.md).
- **R2:** [ADR-0008](../adr/0008-whole-plugin-entries-cover-commands.md), whole-plugin paths; [catalog helpers](../../scripts/catalog.js), bundle detection.
- **R3:** [Codex generator](../../scripts/gen-codex.js), [generated tdd manifest](../../.agents/plugins/packages/tdd/plugin.json), [Codex lifecycle smoke](../../scripts/test-codex-marketplace.sh), and [pi package smoke](../../scripts/test-pi-package.sh). The latter installs the repo as a package from another working directory; it does not test automatic discovery merely by entering the checkout.

## Limitations

Official web documentation is mutable and can describe behavior newer than the README's tested pi `1.0.4` / Codex `0.160.1`; installed checks here used the versions stated above. Did not rerun those older binaries, execute fresh Claude/Codex installation lifecycles, or run the full repository suite. The pi checkout-discovery probe was local/offline and isolated package configuration; it was not an end-to-end skill-behavior test. Did not establish cloud/desktop parity, inspect every upstream skill for behavioral portability, or audit guard implementation safety. README and metadata remain unchanged; no issues, GitHub mutations, or other repository files were written.
