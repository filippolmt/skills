---
name: add-external-skill
description: Add an external skill from a GitHub repo to this marketplace as a git-subdir plugin entry. Fetches the current upstream SHA, appends a correctly-shaped entry to .claude-plugin/marketplace.json, and validates. Usage: /add-external-skill <owner/repo> <path/to/skill-folder> [name]
disable-model-invocation: true
---

Add an external skill to `.claude-plugin/marketplace.json`.

Arguments: `$ARGUMENTS` = `<owner/repo> <path/to/skill-folder> [name]`
- `<owner/repo>`: e.g. `mattpocock/skills`
- `<path/to/skill-folder>`: path inside that repo, e.g. `skills/engineering/tdd`
- `[name]` (optional): plugin/entry name. Default = the last path segment (e.g. `tdd`).

Steps:

1. Parse the arguments. If `owner/repo` or `path` is missing, ask for them.

2. Verify the folder is a real skill — it must contain `SKILL.md` at its root:
   ```bash
   curl -o /dev/null -s -w "%{http_code}" \
     "https://raw.githubusercontent.com/<owner>/<repo>/main/<path>/SKILL.md"
   ```
   If not `200`, stop and report — the `path` is wrong or has no `SKILL.md`.

3. Fetch the current branch HEAD SHA:
   ```bash
   curl -fsSL "https://api.github.com/repos/<owner>/<repo>/commits/main" \
     -H "Accept: application/vnd.github.sha"
   ```

4. Determine the entry `name` (arg or last path segment). Read
   `.claude-plugin/marketplace.json` and confirm no existing plugin uses that
   `name` — names must be unique. If taken, ask for a different one.

5. Append this entry to the `plugins` array in `.claude-plugin/marketplace.json`
   (match the existing formatting exactly):
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

6. Validate:
   ```bash
   claude plugin validate .
   ```
   Report the result. Do not commit — leave that to the user.
