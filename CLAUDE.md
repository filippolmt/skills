# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Claude Code **plugin marketplace**. `.claude-plugin/marketplace.json` is the
catalog; each entry is a plugin. **Granularity is one skill per plugin entry** —
skills are installed individually (`/plugin install <name>`), not in bulk.

## Adding an external skill (the main workflow)

External skills are **referenced upstream** via `git-subdir` — never copied into
this repo. Each entry pins a commit `sha` that Renovate bumps automatically. Use
the exact shape below (one entry per skill):

```json
{
  "name": "<skill-name>",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/<owner>/<repo>",
    "path": "<path/to/skill-folder>",
    "ref": "main",
    "sha": "<current branch HEAD sha>"
  },
  "description": "..."
}
```

Get the SHA: `curl -fsSL https://api.github.com/repos/<owner>/<repo>/commits/main -H "Accept: application/vnd.github.sha"`.
The `path` folder must contain a `SKILL.md` at its root (single-skill plugin).
The `/add-external-skill` skill automates all of this.

## Renovate sync gotcha

`renovate.json` has a `customManager` whose `matchStrings` regex matches the
`git-subdir` entry shape (`url` github + `path` + `ref` + `sha`) and bumps the
`sha` via the `git-refs` datasource (automerge on). **If you change the source
shape in `marketplace.json`, update the regex in `renovate.json` to match** —
otherwise auto-updates silently stop.

## Validate before committing

```
claude plugin validate .    # marketplace + all local plugins
```

Output must be **clean** — no errors *and* no warnings. A warning (e.g. a
`version` that diverges between `plugin.json` and a marketplace entry) is a
fail here: fix it before committing.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `chore:`, …).
- Work on a feature branch (`feat/...`), open a PR to `main` — no direct pushes to `main`.
- Plugin/skill `name` values must be unique across the whole marketplace.
- **Bump the `version` (SemVer) only of the plugin you changed** — never touch the others. Edit it in the plugin's own `plugin.json` (the single source of truth; local-plugin `marketplace.json` entries carry no `version`). `fix:` → patch, `feat:` → minor, breaking → major. The bumped version is the release: merging the PR to `main` ships it. Skip only for changes that don't touch a plugin's behaviour (e.g. repo docs, `renovate.json`).
