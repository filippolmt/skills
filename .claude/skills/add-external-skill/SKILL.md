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

Each entry pins a `sha` Renovate bumps automatically. Plugin `name` unique
across the whole marketplace. **Default: one entry per `SKILL.md`**, `name` =
skill folder basename. Exception: a cohesive upstream plugin (has its own
`.claude-plugin/plugin.json`, bundling skills and/or subagents) becomes a
single **whole-plugin** entry whose `path` is the plugin root — installing it
brings every artifact (skills + subagents), `name` = the `name` in its
`plugin.json`. See `api-scaffolding` / `shell-scripting`.

Discover the skills in a repo with one call (reused by both modes):
```bash
curl -fsSL "https://api.github.com/repos/<owner>/<repo>/git/trees/main?recursive=1" \
  | jq -r '.tree[] | select(.path | endswith("/SKILL.md")) | .path | sub("/SKILL.md$";"")'
```
Fetch the current branch HEAD SHA (shared by all entries from a repo):
```bash
curl -fsSL "https://api.github.com/repos/<owner>/<repo>/commits/main" \
  -H "Accept: application/vnd.github.sha"
```
Fetch a skill's upstream `description` (a concise one-liner — usually the
frontmatter's first sentence): it is stored verbatim in `marketplace.json` and
rendered as-is into the README row.
```bash
curl -fsSL "https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>/SKILL.md"
```
If `curl` is blocked/redirected here, fetch the same URLs via any HTTP tool — the
endpoints are identical.

## Add mode

1. Parse args. If `owner/repo` missing, ask for it.
2. Decide granularity. `path` points at a plugin root (has
   `.claude-plugin/plugin.json`) and you want its subagents too → one
   **whole-plugin** entry at that root; skip per-skill discovery, take `name`
   from the `plugin.json`. Otherwise discover skills: `path` = a skill folder →
   single entry; a parent folder → only folders under it (empty → stop,
   report); omitted → all (batch).
3. Fetch the SHA.
4. `name` = arg (single) or folder basename (batch). Confirm **every** name is
   free in `marketplace.json` — report collisions and ask before proceeding.
5. For each skill, fetch its upstream frontmatter `description` (see the fetch
   above — a concise one-liner, usually the frontmatter's first sentence). Append each entry to the
   `plugins` array (match existing formatting exactly):
   ```json
   {
     "name": "<name>",
     "source": {
       "source": "git-subdir",
       "url": "https://github.com/<owner>/<repo>",
       "path": "<path>",
       "ref": "main",
       "sha": "<sha>"
     },
     "description": "<concise one-liner from the upstream description, stating what the skill does>"
   }
   ```
   Never emit a generic placeholder like `<owner>/<repo> — <name>`: the
   `description` must say what the skill does. If the upstream description is
   empty or unusable, write a one-line summary from the SKILL.md body instead.
   For a **whole-plugin** entry, list its bundled artifacts (agents + skills),
   e.g. `"…: bash-pro and posix-shell-pro agents plus the bash-defensive-patterns,
   bats-testing-patterns, and shellcheck-configuration skills."`.
6. **Regenerate the README** (see below), then validate.

## Update mode

For each `git-subdir` source repo in `marketplace.json` (or the one named):

1. Discover the repo's current skill folders and fetch its latest SHA.
2. Reconcile against the existing entries:
   - **New** upstream folder (no entry) → add an entry (as in add mode).
   - **Removed** upstream (entry whose `path` no longer has `SKILL.md`) → list
     it, **ask to confirm**, then delete the entry.
   - Bump each surviving entry's `sha` to the latest (Renovate also does this;
     harmless to set now).
   - Refresh each entry's `description` from upstream (a concise one-liner,
     usually the `SKILL.md` frontmatter's first sentence — the fetch above).
     `marketplace.json` is the source of truth, so this is what the README shows.
3. **Regenerate the README**, then validate.

## Regenerate the README

The README **Available skills** catalog is a **projection** of
`marketplace.json` produced by `scripts/gen-readme.js` — never hand-edit it. It
rewrites the section between the `<!-- catalog:start -->` / `<!-- catalog:end -->`
markers; skill names, descriptions and URLs come from `marketplace.json`, and
the Modes table is derived from the local `mode-router` plugin's `dependencies`.

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
