---
name: add-external-skill
description: Add or update external skills in this marketplace as git-subdir entries and keep the README catalog in sync. Usage: /add-external-skill <owner/repo> [path] [name] | /add-external-skill update
disable-model-invocation: true
---

Keep `.claude-plugin/marketplace.json` and the README **Available skills** catalog
in sync with upstream external skills.

Arguments: `$ARGUMENTS`
- `<owner/repo> [path] [name]` → **add mode** (default).
- `update` (optionally `update <owner/repo>` to scope to one repo) → **update mode**.

Granularity is the CLAUDE.md rule: one entry per `SKILL.md`, `name` = skill
folder basename; a cohesive upstream plugin becomes one whole-plugin entry whose
`path` is the plugin root, `name` = the `name` in its `plugin.json`.

## Fetches

Both modes use these. `HEAD` resolves the repo's default branch, so `main` vs
`master` is never a guess.

Skill folders in a repo:
```bash
curl -fsSL "https://api.github.com/repos/<owner>/<repo>/git/trees/HEAD?recursive=1" \
  | jq -r '.tree[] | select(.path | endswith("/SKILL.md")) | .path | sub("/SKILL.md$";"")'
```
Latest tags (does this repo publish semver tags?):
```bash
curl -fsSL "https://api.github.com/repos/<owner>/<repo>/tags?per_page=5" | jq -r '.[].name'
```
The SHA a `ref` resolves to — `HEAD` for a branch pin, the tag name for a tag pin:
```bash
curl -fsSL "https://api.github.com/repos/<owner>/<repo>/commits/<ref>" \
  -H "Accept: application/vnd.github.sha"
```
A skill's upstream frontmatter `description` — the **one-liner**, usually its
first sentence, stored verbatim in `marketplace.json` and rendered as-is into the
README row:
```bash
curl -fsSL "https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>/SKILL.md"
```
If `curl` is blocked/redirected here, fetch the same URLs via any HTTP tool — the
endpoints are identical.

## Pinning the `ref`

Renovate updates an entry only when its `ref` has one of two shapes — one
`customManager` in `renovate.json` per shape:

- **Tag** — `vX.Y.Z`, optionally prefixed (`skill-v4.1.2`). Tag and `sha` bump
  together. **The default when the repo publishes semver tags**, and what most
  entries here use. The prefix names the tag series, so a repo publishing
  several (`cli-v*`, `ext-v*`, `skill-v*`) only ever bumps within the one you
  pinned.
- **Branch** — literally `main` or `master`; the `sha` bumps to that branch's
  HEAD. For a repo publishing no usable tags.

A `ref` of any other value (`1.2.0`, `release-2026`, a bare SHA) matches neither
manager, and that entry is then silently never updated again.

## Add mode

1. Parse args. If `owner/repo` missing, ask for it.
2. Decide granularity. `path` points at a plugin root (has
   `.claude-plugin/plugin.json`) and you want its subagents too → one
   **whole-plugin** entry at that root; skip per-skill discovery, take `name`
   from the `plugin.json`. Otherwise discover skills: `path` = a skill folder →
   single entry; a parent folder → only folders under it (empty → stop,
   report); omitted → all (batch).
3. Pick the `ref` (see above), then fetch the SHA it resolves to — one SHA
   shared by every entry from that repo. Confirm the skill's `path` exists at
   that SHA.
4. `name` = arg (single) or folder basename (batch). Confirm **every** name is
   free in `marketplace.json` — report collisions and ask before proceeding.
5. For each skill, fetch its upstream `description` one-liner. Append each entry
   to the `plugins` array (match existing formatting exactly):
   ```json
   {
     "name": "<name>",
     "source": {
       "source": "git-subdir",
       "url": "https://github.com/<owner>/<repo>",
       "path": "<path>",
       "ref": "<tag or branch>",
       "sha": "<sha>"
     },
     "description": "<one line saying what the skill does>"
   }
   ```
   The `description` says what the skill does: upstream's one-liner, or a
   one-line summary written from the `SKILL.md` body when upstream's is empty or
   unusable. For a **whole-plugin** entry, list its bundled artifacts (agents +
   skills), e.g. `"…: bash-pro and posix-shell-pro agents plus the
   bash-defensive-patterns, bats-testing-patterns, and shellcheck-configuration
   skills."`.
6. **Regenerate the README** (see below), then validate.

## Update mode

For each `git-subdir` source repo in `marketplace.json` (or the one named):

1. Discover the repo's current skill folders, and its latest tag or branch HEAD
   to match how its entries are pinned.
2. Reconcile against the existing entries:
   - **New** upstream folder (no entry) → add an entry (as in add mode).
   - **Removed** upstream (entry whose `path` no longer has `SKILL.md`) → list
     it, **ask to confirm**, then delete the entry.
   - Bump each surviving entry to the SHA its `ref` now resolves to: a
     tag-pinned entry moves `ref` and `sha` together to the latest tag, keeping
     its tag series; a branch-pinned entry takes that branch's HEAD. (Renovate
     also does this; harmless to set now.)
   - Refresh each entry's `description` from upstream. `marketplace.json` is the
     source of truth, so this is what the README shows.
3. **Regenerate the README**, then validate.

## Regenerate the README

The README **Available skills** catalog is a **projection** of
`marketplace.json` produced by `scripts/gen-readme.js` — never hand-edit it.

- If you referenced a skill from a **new** source repo, add a group to
  `scripts/catalog-meta.json` (ordered list):
  ```json
  { "repo": "<owner>/<repo>", "tagline": "<short label>", "kind": "skill" }
  ```
  Use `"kind": "plugin"` for a whole-plugin entry (renders a "What it bundles"
  column). The generator **throws** if any git-subdir entry's repo has no group
  (or is not omitted / a mode-router dependency), so this can't be silently
  missed.
- Run the generator:
  ```bash
  node scripts/gen-readme.js
  ```

## Finish

```bash
node scripts/gen-readme.js --check   # README catalog is in sync with marketplace.json
claude plugin validate .
```
Report what changed (added / removed / description updates). Do not commit —
leave that to the user.
