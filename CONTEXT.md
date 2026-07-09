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
- **Catalog projection** — the README "Available skills" section. NOT a source
  of truth: it is generated from the catalog by `scripts/gen-readme.js` and
  spliced between the `<!-- catalog:start -->` / `<!-- catalog:end -->` markers.
  Never hand-edited.
- **Catalog-meta** — `scripts/catalog-meta.json`. The only irreducible editorial
  data behind the projection: ordered source repos with a display **tagline** and
  a column **kind** (`skill` → "What it does", `plugin` → "What it bundles"), plus
  an **omit** list. Everything else in the projection is derived from the catalog.
- **Modes table** — the projection's final table (`caveman`, `ponytail`). Not
  configured in catalog-meta: derived from the local `mode-router` plugin's
  `dependencies`.

## Mode router

- **Mode** — one of `auto` / `caveman` / `ponytail` / `off`, chosen by the
  control file `~/.config/mode-router/state.json`.
- **Reload flag** — the per-session file `route.js` uses to detect a fresh or
  compacted context, so a mode skill is (re)invoked only when it is actually
  gone. See `plugins/mode-router/skills/mode-router/ROUTING.md`.
