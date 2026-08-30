# CLAUDE.md

## What this repo is

A Claude Code **plugin marketplace**. `.claude-plugin/marketplace.json` is the
catalog; each entry is a plugin, installed on its own (`/plugin install <name>`),
not in bulk. **Default granularity is one skill per entry.**

**Exception — whole-plugin entries.** An upstream repo shipping a cohesive plugin
that bundles several skills and/or subagents (a folder with its own
`.claude-plugin/plugin.json`) gets a **single `git-subdir` entry whose `path` is
the plugin root**: installing it brings every artifact at once. See
`api-scaffolding` and `shell-scripting` from `wshobson/agents`.

## Adding or updating an external skill

External skills are **referenced upstream** via `git-subdir` — never copied into
this repo. Both branches run through the user-invoked **`/add-external-skill`**
skill: `<owner/repo> [path] [name]` appends entries, `update` reconciles existing
ones against upstream (skills added and removed, tag/`sha` bumps, refreshed
descriptions). It also picks the `ref`, regenerates the README and validates.
Copy the entry shape from any existing `git-subdir` entry.

## Gotchas

**The Renovate seam.** `renovate.json` matches the `git-subdir` entry shape with
two `customManager` regexes, told apart by `ref` (`main`/`master` vs
`[prefix-]vX.Y.Z`). A regex that stops matching fails **silently** — zero
matches, no error, auto-updates simply stop. So the entry shape and both regexes
move together, and `scripts/check-renovate.js` asserts they cover the catalog
exactly.

**Double-registered hooks.** A local plugin's `hooks/hooks.json` loads
automatically; `manifest.hooks` (in `.claude-plugin/plugin.json`) is for
*additional* hook files beyond that path, so pointing it at the standard one
loads the file twice (`Duplicate hooks file detected`). A stale entry in
`.claude/settings.local.json` pointing at a plugin's hook script does the same
**silently**: no warning, the hook just runs twice per event. A hook firing twice
→ check those two places first.

## Validate before committing

```
for t in scripts/*.test.js plugins/*/hooks/*.test.js; do node "$t"; done
node scripts/gen-readme.js --check    # README catalog matches marketplace.json
node scripts/check-renovate.js        # Renovate regexes cover every git-subdir entry
node scripts/check-name-collisions.js # what validate does NOT cover
claude plugin validate .              # marketplace + all local plugins
```

This is what CI runs (`.github/workflows/validate.yml`). A `PostToolUse` hook
(`.claude/settings.json`) runs the last two on every edit to `marketplace.json`,
`plugin.json`, a `SKILL.md` or a `commands/*.md`, and blocks the edit (exit 2) if
either fails — the rest are yours to run.

Output must be **clean** — no errors *and* no warnings. A warning (e.g. a
`version` that diverges between `plugin.json` and a marketplace entry) is a fail
here: fix it before committing.

`claude plugin validate` compares catalog `name` values against each other and
nothing more. A local plugin's **command** colliding with another plugin's
**skill** is a real collision it misses — the harness resolves it to one of them
while a hook reading the raw prompt text can act as if it were the other, which
shipped a defect (`docs/adr/0004-rename-the-handoff-command.md`).
`check-name-collisions.js` is what closes that gap.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `chore:`, …).
- Work on a feature branch (`feat/...`), open a PR to `main` — no direct pushes to `main`.
- `name` values are unique across the whole marketplace, and a local plugin's command and skill names are unique against each other and against every catalog entry.
- **Bump the `version` (SemVer) only of the plugin you changed** — never touch the others. Edit it in the plugin's own `plugin.json` (the single source of truth; local-plugin `marketplace.json` entries carry no `version`). `fix:` → patch, `feat:` → minor, breaking → major. **Below `1.0.0` a breaking change is a minor**, not a major — every local plugin is still pre-1.0. The bumped version is the release: merging the PR to `main` ships it. Skip only for changes that don't touch a plugin's behaviour (e.g. repo docs, `renovate.json`).
