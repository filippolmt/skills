# CLAUDE.md

## What this repo is

A skill marketplace for three harnesses, all projected from one catalog:
`.claude-plugin/marketplace.json`. Each entry is a plugin installed on its own
(`/plugin install <name>`). **Default granularity is one skill per entry.**

- **Claude** installs from the catalog by reference: external entries name a
  folder upstream and pin a `sha`.
- **pi** consumes vendored copies in the generated tree at `skills/`.
- **Codex** installs generated native packages from
  `.agents/plugins/marketplace.json`, each holding real copies of its skills.
  `.agents/skills` is absent so that loose copies and bundled copies cannot
  collide (ADR-0021).

`skills/` and `.agents/` are generated: change the catalog and regenerate. A
Claude-only guard with no portable form is left out of Codex and pi;
`docs/distribution-parity.md` lists every such limitation.

**Whole-plugin entries.** Some upstream plugins (a folder with its own
`.claude-plugin/plugin.json`) ship further skills, subagents or commands that a
per-skill entry would drop. Such a plugin gets a single `git-subdir` entry whose
`path` is the plugin root (see `api-scaffolding`). Hooks and mirrors beside a
canonical `skills/` do not count (ADR-0036). A plugin at the repo root is a
**url entry** instead: `"source": "url"` with `url`, `ref` and `sha`, and no
`path` (see `diagram-design`, ADR-0033).

## External entries

Add or update them with `/add-external-skill`; this also applies when the
request comes in plain words. Commit the catalog change plus the README regions
from `node scripts/gen-readme.js`. Leave every other projection to CI's
`regenerate` workflow. Regeneration, pruning and the upstream drift reports are
covered in `docs/agents/external-entries.md`.

## Gotchas

**The Renovate seam.** `renovate.json` matches the external entry shape with two
`customManager` regexes, told apart by `ref`: `main`/`master` against
`[prefix-]vX.Y.Z`. A regex that stops matching fails **silently**: there is no
error, auto-updates just stop. Change the entry shape and both regexes together;
`scripts/check-renovate.js` asserts that they cover the catalog.

**A hook firing twice.** Check two places:

- `manifest.hooks` in a local plugin's `plugin.json` pointing at
  `hooks/hooks.json`, which already loads automatically. `manifest.hooks` is
  only for additional files.
- A stale entry in `.claude/settings.local.json` pointing at the plugin's hook
  script. This one gives no warning.

**Names.** `name` values are unique across the marketplace, and a local
plugin's command names and skill names are unique against each other and
against every catalog entry. `claude plugin validate` compares only catalog
names. A command colliding with another plugin's skill is caught by
`scripts/check-name-collisions.js` (ADR-0004).

## Validate before committing

```
bash scripts/validate.sh --isolated       # full validation in a disposable snapshot; leaves this checkout untouched
bash scripts/validate.sh --catalog-only   # a catalog-only change: skips projection checks and smokes
git config core.hooksPath .githooks       # once per clone: pre-push runs scripts/run-tests.sh
```

Output must be **clean**: zero errors and zero warnings, from every check.
After a `sha` bump the committed projections are stale by design; pull-request
validation skips them, and `regenerate` handles them. Which check a change
needs, delegated distribution work and the acceptance matrix are in
`docs/agents/distribution-validation.md`. A mod's tests, typecheck and live
checks are in `docs/agents/mod-testing.md`.

## Versioning

Bump the SemVer `version` of the one plugin you changed, in that plugin's own
`plugin.json`; local-plugin catalog entries carry none. The mapping is:

- `fix:` → patch;
- `feat:` → minor;
- breaking → major, except below `1.0.0`, where it is a minor (every local
  plugin is still pre-1.0).

Merging to `main` ships it. A change that leaves every plugin's behaviour alone
(repo docs, `renovate.json`) takes no bump.

## Conventions

- Conventional Commits; commit messages, PR titles and PR bodies in English.
- Work on a feature branch (`feat/...`) and open a PR to `main`; `main` takes
  merges only.
- Before switching branches after a reported merge, fetch, then verify a clean
  worktree and the merged commit on `origin/main`; preserve uncommitted work.

## Agent skills

### Domain docs

`GLOSSARY.md` is the naming authority. Read it before coining a name, and
whenever a task says *bundle*, *projection*, *overlay*, *guard* or *spawn*: each
of these terms is narrower here than in everyday use. `docs/adr/` holds one
decision per file. Read the ADR a rule cites before changing that rule, and
write a new ADR when you settle a question the next agent would otherwise
reopen. Guard reviews and cross-harness projection reviews also read
`CODING_STANDARDS.md`.

### Issue tracker

GitHub Issues: `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `docs/agents/triage-labels.md`.
