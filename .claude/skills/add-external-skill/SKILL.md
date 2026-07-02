---
name: add-external-skill
description: Add external skill(s) from a GitHub repo to this marketplace as git-subdir plugin entries. Fetches the current upstream SHA, appends correctly-shaped entries to .claude-plugin/marketplace.json, and validates. Usage: /add-external-skill <owner/repo> [path/to/skill-folder] [name]
disable-model-invocation: true
---

Add external skill(s) to `.claude-plugin/marketplace.json`.

Arguments: `$ARGUMENTS` = `<owner/repo> [path] [name]`
- `<owner/repo>`: e.g. `mattpocock/skills`
- `[path]`: folder inside the repo. A **skill folder** (contains `SKILL.md`) →
  one entry. A **parent folder** or omitted → **batch**: every skill under it.
- `[name]` (optional, single only): entry name. Default = last path segment.

Each entry pins a `sha` Renovate bumps automatically. Plugin `name` = skill
folder basename, unique across the whole marketplace.

## Steps

1. Parse args. If `owner/repo` missing, ask for it.

2. Discover skills — one call lists every `SKILL.md` in the repo:
   ```bash
   curl -fsSL "https://api.github.com/repos/<owner>/<repo>/git/trees/main?recursive=1" \
     | jq -r '.tree[] | select(.path | endswith("/SKILL.md")) | .path | sub("/SKILL.md$";"")'
   ```
   - `path` given and it IS a skill folder (in the list) → single entry.
   - `path` given as a parent → keep only folders under it. Empty → stop, report.
   - `path` omitted → all discovered folders (batch).

3. Fetch the current branch HEAD SHA (shared by all entries):
   ```bash
   curl -fsSL "https://api.github.com/repos/<owner>/<repo>/commits/main" \
     -H "Accept: application/vnd.github.sha"
   ```

4. For each folder, entry `name` = arg (single) or folder basename (batch).
   Read `.claude-plugin/marketplace.json`; confirm **every** name is free —
   names must be unique. Report collisions and ask before proceeding.

5. Append each entry to the `plugins` array (match existing formatting exactly):
   ```json
   {
     "name": "<name>",
     "source": {
       "source": "git-subdir",
       "url": "https://github.com/<owner>/<repo>",
       "path": "<path>",
       "ref": "main",
       "sha": "<sha from step 3>"
     },
     "description": "<owner>/<repo> — <name>"
   }
   ```

6. Validate. Report the result. Do not commit — leave that to the user.
   ```bash
   claude plugin validate .
   ```

If `curl` is blocked/redirected in this environment, fetch the same URLs via
whatever HTTP tool is available — the API endpoints are identical.
