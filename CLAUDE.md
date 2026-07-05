# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Claude Code **plugin marketplace**. `.claude-plugin/marketplace.json` is the
catalog; each entry is a plugin. **Granularity is one skill per plugin entry** —
skills are installed individually (`/plugin install <name>`), not in bulk.

## Adding an external skill (the main workflow)

External skills are **referenced upstream** via `git-subdir` — never copied into
this repo. Each entry is one skill, pins a commit `sha` that Renovate bumps
automatically, and points at a folder containing a `SKILL.md` at its root. Run
the `/add-external-skill` skill: it fetches the SHA and appends a
correctly-shaped entry. For the exact entry shape, see that skill or any existing
`git-subdir` entry in `marketplace.json`.

## Renovate sync gotcha

`renovate.json` has a `customManager` whose `matchStrings` regex matches the
`git-subdir` entry shape (`url` github + `path` + `ref` + `sha`) and bumps the
`sha` via the `git-refs` datasource (automerge on). **If you change the source
shape in `marketplace.json`, update the regex in `renovate.json` to match** —
otherwise auto-updates silently stop.

## Local plugin hooks gotcha

A local plugin's `hooks/hooks.json` is loaded **automatically**. Do NOT also
point `manifest.hooks` (in `.claude-plugin/plugin.json`) at it — that loads the
file twice: `Duplicate hooks file detected`. The `hooks` manifest field is only
for *additional* hook files beyond the standard path.

## Validate before committing

```
claude plugin validate .    # marketplace + all local plugins
```

Output must be **clean** — no errors *and* no warnings. A warning (e.g. a
`version` that diverges between `plugin.json` and a marketplace entry) is a
fail here: fix it before committing.

A `PostToolUse` hook (`.claude/settings.json`) auto-runs this validation on
every edit to `marketplace.json`, `plugin.json`, or a `SKILL.md`, and blocks
the edit (exit 2) if it fails.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `chore:`, …).
- Work on a feature branch (`feat/...`), open a PR to `main` — no direct pushes to `main`.
- Plugin/skill `name` values must be unique across the whole marketplace.
- **Bump the `version` (SemVer) only of the plugin you changed** — never touch the others. Edit it in the plugin's own `plugin.json` (the single source of truth; local-plugin `marketplace.json` entries carry no `version`). `fix:` → patch, `feat:` → minor, breaking → major. The bumped version is the release: merging the PR to `main` ships it. Skip only for changes that don't touch a plugin's behaviour (e.g. repo docs, `renovate.json`).
