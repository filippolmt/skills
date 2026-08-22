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
- **Mailbox opt-out** — how a deliberate teammate survives the guard:
  `[mailbox]` in the call's `description` (per call), or
  `ALLOW_NAMED_AGENTS=1` (session-wide).

## Mode router

- **Mode** — one of `auto` / `caveman` / `ponytail` / `off`, chosen by the
  control file `~/.config/mode-router/state.json`.
- **Loaded-mode set** — the mode skills known to be present in the current
  context. A mode is (re)invoked only when it is missing from the set. See
  `plugins/mode-router/skills/mode-router/ROUTING.md`.
- **Mixed context** — a context holding both mode skills. Once the second one is
  invoked it stays, so any long session becomes one. Not a failure state:
  per-turn suspension is how a mixed context still answers in exactly one mode.
- **Per-turn suspension** — how exclusivity is kept: the turn's routing text
  applies the mode the request classifies to and declares the other one to
  contribute nothing that turn, not even to the prose. Words rather than
  enforcement, and per turn rather than per context — the suspended mode is still
  loaded, just inert.
- **Context reset** — the event that empties the loaded-mode set: session
  startup, clear, compaction, or fork. A resume is not one: it rebuilds the same
  context, so the loaded modes are still in it.
- **Handoff note** — what a context leaves behind for the one that replaces it:
  what has been established, what remains, and the prompt to re-send afterwards.
  The user asks for it explicitly before a deliberate `/clear` — the router never
  demands one. Belongs to the project, not to the session it was written in, so it
  survives the reset. The artifact, not the act of producing it.
- **Carryover** — the act of having the pending handoff note written. Named apart
  from the note so that one word does not stand for both.
