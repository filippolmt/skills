# CONTEXT — domain glossary

Domain language for this marketplace. Use these names in code, docs, and design
discussion. (Architecture vocabulary — module, seam, depth — lives in the
`codebase-design` skill; this file names the *domain*.)

## Catalog

- **Marketplace catalog** — the `plugins` array in
  `.claude-plugin/marketplace.json`. The single source of truth for what this
  marketplace offers. Every other tree in this repo is derived from it — the
  README's catalog projection and the skills tree pi reads.
- **Plugin entry** — one object in the catalog. Either a **local plugin** (its
  `source` is a repo-relative path, e.g. `./plugins/agent-report-guard`) or a
  **git-subdir entry** (references an upstream folder, pins a `sha`).
- **Whole-plugin entry** — a git-subdir entry whose `path` points at an upstream
  plugin root (its own `.claude-plugin/plugin.json`); installing it brings every
  bundled skill and subagent at once.
- **Whole source** — a git-subdir source repo whose every skill is catalogued: a
  new upstream skill gets an entry unless it is a **catalog exclusion**
  (`docs/adr/0014-each-source-repo-is-whole-or-curated.md`, which classifies
  each repo).
- **Curated source** — a git-subdir source repo whose skills are picked by hand: a
  new upstream skill is reported, never added.
- **Catalog exclusion** — an upstream skill deliberately left without an entry,
  listed with its reason in ADR-0014. Neither added nor reported by
  `/add-external-skill update`.
- **Bundle** — a local plugin that ships no artifacts of its own: its entry
  exists only to pull dependencies in. A targeted bundle brings one skill plus
  everything it calls at runtime; a suite bundle brings a curated set of
  workflows used together. A local plugin with no `skills/`, `commands/`, `hooks/` or
  `agents/` directory IS one — derived, never listed. It appears in the **bundle
  projection** and nowhere else in the README.
- **Catalog projection** — the README "Available skills" section. NOT a source
  of truth: it is generated from the catalog by `scripts/gen-readme.js` and
  spliced between the `<!-- catalog:start -->` / `<!-- catalog:end -->` markers.
  Never hand-edited.
- **Bundle projection** — the README's table of bundles, the other region
  `scripts/gen-readme.js` generates, spliced between the
  `<!-- bundles:start -->` / `<!-- bundles:end -->` markers. It lives under the
  README's "Installing skills" heading, beside the install instructions rather
  than in the catalog projection, because a reader choosing between an individual
  skill and a suite bundle needs it at that moment. Its cells name each bundle's
  `dependencies`, not its description. Never hand-edited. Its content is
  **disjoint** from the catalog projection's: the one derived set of bundles is
  subtracted from that one and selected for this one
  (`docs/adr/0012-the-bundle-table-lives-next-to-the-install.md`).
- **Catalog-meta** — `scripts/catalog-meta.json`. The irreducible editorial data
  behind the **catalog projection**: ordered source repos with a display
  **tagline** and a column **kind** (`skill` → "What it does", `plugin` → "What
  it bundles"). Everything else in that projection is derived from the catalog.
  Its **omit** list is not editorial in that sense and is empty: it once named
  the seven bundles, which the derived set has handled since — first by
  subtracting them, now by routing them to the bundle projection instead.

## Agent distribution

- **Artifact inventory** — the complete set of skills, commands, agents, hooks,
  MCP configuration and other distribution-relevant artifacts discovered under one
  plugin entry's source. Unknown artifacts fail validation rather than disappearing.
- **Harness disposition** — one artifact's outcome for one harness: **native** when
  it travels unchanged, **adapted** when it keeps its user-facing outcome through a
  harness-specific representation, or **unsupported** with an exact limitation and
  fallback. A manual workaround is unsupported with a fallback, not parity.
- **Runtime closure** — the transitive set of skills and adaptations an installable
  workflow needs to work in a fresh session. It is declared where it cannot be
  derived; it is not guessed from prose.
- **Parity matrix** — the generated, human-readable join of the artifact inventory
  and harness dispositions. It reports every catalog entry and artifact for Codex
  and pi; it is not a second catalog.
- **Codex package projection** — the generated, self-contained native Codex plugin
  for one marketplace catalog entry. Its runtime closure is materialised inside the
  package; unsupported entries receive no installable stub.
- **Skills tree** — `skills/`, one directory per portable skill or deterministic
  command/agent conversion. A further **catalog projection**: derived from the
  marketplace catalog, checked in CI, never hand-edited. It is pi's **loose-skill projection**; Codex's legacy scan-root route
  remains only until the native package projection replaces it (ADR-0021). Claude
  reads the catalog instead.
- **Loose-skill projection** — a harness-neutral tree of unbundled skills, without
  plugin identity, hooks or MCP configuration. Here it is the skills tree consumed
  by pi; it is a fallback rather than first-class Codex distribution.
- **Regeneration PR** — the single long-lived `chore/regenerate-skills-tree` PR the
  `regenerate` workflow opens, force-pushes onto and merges on green. Not a review
  request: the catalog entry it materialises is where the decision was reviewed, and
  this is the audit record (ADR-0011).
- **Prune** — what a regeneration does to an entry whose `path` no longer exists at
  its `sha`: the entry leaves the catalog, its name leaves every bundle's
  `dependencies` (breaking bump), and the regeneration PR names it. Not a skip — a
  removal, recorded (ADR-0015). Refused, turning the run red, when a non-bundle
  depends on the entry or a bundle would lose the skill it is named after.
- **Parked run** — the `pull_request` run of `validate` that a `GITHUB_TOKEN` push
  leaves `completed` with `conclusion: action_required` and no check runs: created,
  awaiting an approval no token inside a workflow can give. Not a missing check — a
  waiting one, and the reason the push needs an identity of its own.
- **Regeneration token** — `REGEN_TOKEN`, the secret the regeneration job pushes
  with so its `validate` run is not parked. Scoped to this repository,
  `contents: write` + `pull-requests: write`, and it expires: the job's first step
  fails by name when it is empty (ADR-0011).
- **Vendored copy** — an upstream skill's files reproduced in the skills tree at the
  `sha` its entry pins, beside that upstream's licence and a `SOURCE.md`. What the
  tree holds instead of a reference.
- **Overlay** — a harness-specific edit to a vendored copy, held apart from it as a patch
  so the copy stays identical to upstream. Named for the separation: an edit made
  *in* the copy is a fork, not an overlay.
- **Overlay drift** — an overlay whose upstream has moved under it. Surfaces as the
  patch failing to apply, which is the property the form is chosen for.
- **Portable entry** — a catalog entry that has a vendored copy. Excluded are the
  bundles and the guards: neither agent has `dependencies` or a
  subagent a plugin can ship, and pi has no declarative hooks at all.
- **pi package** — this repository installed whole, as one unit. There is exactly
  one, never one per entry, because pi has no per-subdirectory source.
- **Ref-less source** — a pi package source carrying no `ref`. The only shape that
  an explicit `pi update --extensions` advances, and the reason the skills tree
  lives on `main`; pi does not update existing packages at startup.
- **Convention directory** — `skills/` at the root of a pi package, served with no
  manifest field naming it. Where the skills tree lives, and the reason this repo
  needs no `package.json`.
- **Shared location** — `.agents/skills`, the Agent Skills standard's loose-skill
  path. This repository deliberately has no shared location: ADR-0021 removed the
  former symlink once every supported Codex package was materialised, preventing
  duplicate loose and plugin-bundled identities. pi continues to consume the root
  convention directory.
- **Pinned source** — a pi package source carrying any `ref` — branch, tag or
  commit. Beware the inversion: in pi's vocabulary *pinned* means **never
  advanced**, where a pinned `sha` in this catalog is what Renovate advances.
- **Version gate** — the rule by which Codex refreshes an installed plugin: only
  when the manifest's `version` differs from the installed one. Not the ref, and not
  the commit — which is why a generated Codex plugin has to bump it.
- **Package filter** — the `skills` array of a settings entry, selecting which
  resources of an installed package are active. Where "install one skill" lives on
  the pi side, installation itself being all-or-nothing.
- **Settings snippet** — a generated block the user pastes into
  `~/.pi/agent/settings.json` (global) or a consuming project's `.pi/settings.json`.
  The repo recommends; it cannot write into either file.

## Guards

- **Guard** — a local plugin whose whole content is `PreToolUse` hooks standing
  between a tool call and a known-wrong form of it: `agent-report-guard` on
  `Agent`, `zsh-wordsplit-guard` on `Bash`. Rewrites the call or denies it, and
  says which.
- **Opt-out** — how a deliberate use survives a guard rule whose fix changes
  what the call does: a marker in the call's `description` for one call
  (`[mailbox]`, `[nosplit]`), or an environment variable for the session
  (`ALLOW_NAMED_AGENTS=1`, `ALLOW_ZSH_NOSPLIT=1`). A rule whose fix is a
  same-meaning rewrite — quoting, escaping — has none: the rewrite is the way
  through.

## Agent spawns

- **Named spawn** — an `Agent` tool call that passes `name`. The harness
  registers it as a **mailbox teammate**; the tool result carries no report.
- **Unnamed spawn** — an `Agent` call without `name`. It **reports back** on its
  own: the report arrives as the tool result, or in the completion notification.
- **Mailbox teammate** — a subagent addressable by name via `SendMessage`
  (`"taskKind": "in_process_teammate"` in its `.meta.json`). When it finishes it
  emits an **idle notification** — an envelope with no report body — so the
  report has to be chased with `SendMessage`.
- **Fan-out skill** — a skill that spawns sibling subagents and then reads their
  reports (`code-review`'s two axes, `research`, `printing-press`). It assumes an
  unnamed spawn; a named one leaves it waiting. The local `agent-report-guard`
  plugin is what enforces that assumption.

## Word splitting

- **Silent non-split** — what zsh does to a parameter expansion that is not an
  explicit split: `for x in $var` iterates once over the whole string. Named for
  its failure mode, not its mechanism — it does not error, and a one-element
  sample hides it.
- **Splitting expansion** — a form that does yield several words in zsh:
  `${=var}` (on IFS), `${(f)var}` (per line), an array expansion, or a command
  substitution. What a silent non-split is rewritten into.
- **Bare expansion** — a word of a `for` list that is one non-splitting
  expansion, with nothing glued on that changes the outcome: `$var`, `${var}`,
  `$var,`, `${var}x`. The only shape a guard can call a silent non-split, since
  a glob or a path separator around the expansion decides the word count
  instead — see `docs/adr/0005-what-the-wordsplit-guard-flags.md`.
- **Expansion trap** — a form zsh expands differently from bash: a leading `=`
  (equals expansion), a glob in a `--flag=value` word, parentheses in a
  `${var/pattern/…}` pattern, bash's `${!…}`. The wordsplit guard's second rule
  set; each deny names the zsh rewrite, so it carries no opt-out — see
  `docs/adr/0022-the-wordsplit-guard-also-flags-zsh-expansions.md` and
  `docs/adr/0023-the-wordsplit-guard-flags-indirect-expansion.md`.
