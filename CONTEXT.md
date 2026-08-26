# CONTEXT — domain glossary

Domain language for this marketplace. Use these names in code, docs, and design
discussion. (Architecture vocabulary — module, seam, depth — lives in the
`codebase-design` skill; this file names the *domain*.)

## Catalog

- **Marketplace catalog** — the `plugins` array in
  `.claude-plugin/marketplace.json`. The single source of truth for what this
  marketplace offers.
- **Plugin entry** — one object in the catalog. Either a **local plugin** (its
  `source` is a repo-relative path, e.g. `./plugins/mode-router`) or a
  **git-subdir entry** (references an upstream folder, pins a `sha`).
- **Whole-plugin entry** — a git-subdir entry whose `path` points at an upstream
  plugin root (its own `.claude-plugin/plugin.json`); installing it brings every
  bundled skill and subagent at once.
- **Bundle** — a local plugin that ships no artifacts of its own: its entry
  exists to pull dependencies in. Not listed anywhere — a local plugin with no
  `skills/`, `commands/`, `hooks/` or `agents/` directory IS one, which is what
  keeps it out of the projection.
- **Catalog projection** — the README "Available skills" section. NOT a source
  of truth: it is generated from the catalog by `scripts/gen-readme.js` and
  spliced between the `<!-- catalog:start -->` / `<!-- catalog:end -->` markers.
  Never hand-edited.
- **Catalog-meta** — `scripts/catalog-meta.json`. The irreducible editorial data
  behind the projection: ordered source repos with a display **tagline** and a
  column **kind** (`skill` → "What it does", `plugin` → "What it bundles").
  Everything else in the projection is derived from the catalog. Its **omit** list
  is not editorial in that sense and is empty: it once named the seven bundles,
  which now omit themselves.
- **Modes table** — the projection's final table (`caveman`, `ponytail`). Not
  configured in catalog-meta: derived from the local `mode-router` plugin's
  `dependencies`.

## Guards

- **Guard** — a local plugin whose whole content is a `PreToolUse` hook standing
  between a tool call and a known-wrong form of it: `agent-report-guard` on
  `Agent`, `zsh-wordsplit-guard` on `Bash`. Rewrites the call or denies it, and
  says which.
- **Opt-out** — how a deliberate use survives a guard: a marker in the call's
  `description` for one call (`[mailbox]`, `[nosplit]`), or an environment
  variable for the session (`ALLOW_NAMED_AGENTS=1`, `ALLOW_ZSH_NOSPLIT=1`).

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

## Mode router

- **Mode** — one of `auto` / `caveman` / `ponytail` / `off`, chosen by the
  control file `~/.config/mode-router/state.json`.
- **Loaded-mode set** — the mode skills known to be present in the current
  context. A mode is (re)invoked only when it is missing from the set. See
  `plugins/mode-router/skills/mode-router/ROUTING.md`.
- **Mode switch** — a request that classifies to the mode a context does not
  hold, while it holds the other one. The router does not load the missing mode:
  the turn is spent on the **switch notice**, and the user chooses.
- **Switch clause** — what the router tells the model on a turn with one mode
  loaded: apply that mode, or — on a mode switch — do not load the other and
  answer with the switch notice instead.
- **Switch notice** — the one-line answer the user sees on a mode switch: which
  mode the request wanted, which one the context holds, the recommended
  carryover and reset, and the word that declines it. A recommendation — the
  router never demands the reset. Declining it gets the request answered in no
  mode at all.
- **Mode veto** — the router refusing a mode skill's invocation because the
  context already holds the other mode. Backs up the switch clause; it stops the
  model's call, never the user's typed slash. A forced mode is waved in — only
  that one.
- **Mixed context** — a context holding both mode skills. Reached only by the
  user typing the second mode; the router never produces one. Tolerated, not a
  failure: per-turn suspension is how it still answers in exactly one mode.
- **Per-turn suspension** — how a mixed context keeps exclusivity: the turn's
  routing text applies the mode the request classifies to and declares the other
  one to contribute nothing that turn, not even to the prose. Words rather than
  enforcement, and per turn rather than per context — the suspended mode is still
  loaded, just inert.
- **Context reset** — the event that empties the loaded-mode set: session
  startup, clear, compaction, or fork. A resume is not one: it rebuilds the same
  context, so the loaded modes are still in it.
- **Handoff note** — what a context leaves behind for the one that replaces it:
  what has been established, what remains, and the prompt to re-send afterwards.
  The user asks for it explicitly before a deliberate `/clear` — the router
  recommends one on a mode switch and never demands it. Belongs to the project,
  not to the session it was written in, so it survives the reset. The artifact,
  not the act of producing it.
- **Carryover** — the act of having the pending handoff note written. Named apart
  from the note so that one word does not stand for both.

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
