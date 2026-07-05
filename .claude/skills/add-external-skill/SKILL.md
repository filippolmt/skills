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

Each entry pins a `sha` Renovate bumps automatically. Plugin `name` = skill
folder basename, unique across the whole marketplace. One entry per `SKILL.md`.

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
Fetch a skill's upstream `description` (first sentence of its frontmatter — used
for both the entry and the README row):
```bash
curl -fsSL "https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>/SKILL.md"
```
If `curl` is blocked/redirected here, fetch the same URLs via any HTTP tool — the
endpoints are identical.

## Add mode

1. Parse args. If `owner/repo` missing, ask for it.
2. Discover skills. `path` = a skill folder → single entry; a parent folder →
   only folders under it (empty → stop, report); omitted → all (batch).
3. Fetch the SHA.
4. `name` = arg (single) or folder basename (batch). Confirm **every** name is
   free in `marketplace.json` — report collisions and ask before proceeding.
5. For each skill, fetch its upstream frontmatter `description` (see the fetch
   above — first sentence, trimmed to one line). Append each entry to the
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
     "description": "<first sentence of the upstream description, stating what the skill does>"
   }
   ```
   Never emit a generic placeholder like `<owner>/<repo> — <name>`: the
   `description` must say what the skill does. If the upstream description is
   empty or unusable, write a one-line summary from the SKILL.md body instead.
6. **Sync the README** (see below), then validate.

## Update mode

For each `git-subdir` source repo in `marketplace.json` (or the one named):

1. Discover the repo's current skill folders and fetch its latest SHA.
2. Reconcile against the existing entries:
   - **New** upstream folder (no entry) → add an entry (as in add mode).
   - **Removed** upstream (entry whose `path` no longer has `SKILL.md`) → list
     it, **ask to confirm**, then delete the entry.
   - Bump each surviving entry's `sha` to the latest (Renovate also does this;
     harmless to set now).
3. **Sync the README** (this also picks up changed upstream descriptions), then
   validate.

## Sync the README

The README **Available skills** section has one `### [owner/repo](url)` table per
source repo, rows `| \`<name>\` | <one-line> |`. Make it match `marketplace.json`:

- The one-line is the entry's `description` in `marketplace.json` (the trimmed
  first sentence of the upstream frontmatter — see add mode step 5). In update
  mode, re-fetch it (same fetch as above) to pick up upstream changes.
- Add a row for each new entry, drop the row for each removed entry, and refresh
  any row whose upstream description changed.
- Keep the note that `.claude-plugin/marketplace.json` is the source of truth.

## Finish

```bash
claude plugin validate .
```
Report what changed (added / removed / description updates). Do not commit —
leave that to the user.
