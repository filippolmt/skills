# filippo-skills

A Claude Code plugin marketplace — a collection of reusable skills installable
via git.

## Structure

```
.claude-plugin/marketplace.json   # marketplace catalog
plugins/
  example-plugin/
    .claude-plugin/plugin.json     # plugin manifest
    skills/
      hello/SKILL.md               # skill (example template)
```

## Installing skills (individually)

Each skill is its own plugin, so you only install the ones you want:

```
/plugin marketplace add <git-url-of-this-repo>
/plugin install tdd
/plugin install grill-me
```

Then invoke them namespaced: `/tdd:tdd`, `/grill-me:grill-me`. Model-invoked
skills (e.g. `grilling`) are triggered by Claude automatically when relevant.

To refresh after upstream updates:

```
/plugin marketplace update filippo-skills
```

## External skills (auto-updated by Renovate)

Third-party skills (e.g. `mattpocock/skills`) are referenced upstream via
`git-subdir` — no files are copied. Each skill subdirectory becomes a
single-skill plugin you can install on its own. Renovate bumps the pinned commit
whenever upstream changes (automerge enabled).

The fastest way to add one is the `/add-external-skill` skill, which automates
every step below. Point it at a skill folder to add one skill, or at a repo /
parent folder to batch-add every `SKILL.md` under it:

```
/add-external-skill <owner/repo> [path/to/skill-folder] [name]
```

To do it by hand instead:

1. Get the current branch SHA:

   ```bash
   curl -fsSL https://api.github.com/repos/<owner>/<repo>/commits/main \
     -H "Accept: application/vnd.github.sha"
   ```
2. Add an entry to `.claude-plugin/marketplace.json` (one per skill):

   ```json
   {
     "name": "<skill-name>",
     "source": {
       "source": "git-subdir",
       "url": "https://github.com/<owner>/<repo>",
       "path": "<path/to/skill-folder>",
       "ref": "main",
       "sha": "<sha-from-step-1>"
     },
     "description": "..."
   }
   ```
3. Done. The `customManager` in `renovate.json` matches every entry of this shape
   (github `url` + `path` + `ref` + `sha`), tracks the branch via the `git-refs`
   datasource, and opens SHA-bump PRs that merge themselves (automerge). Entries
   from the same repo are grouped into a single PR.

The folder pointed to by `path` must be a valid skill (contain `SKILL.md`).

## Adding your own skill to a plugin

1. Create `plugins/<plugin>/skills/<name>/SKILL.md`.
2. Minimal frontmatter:

   ```yaml
   ---
   name: <name>
   description: <when and why to use it — drives automatic triggering>
   ---
   ```
3. Write the operating instructions in the body. Done — invocable as
   `/<plugin>:<name>`.

Fastest path: copy `plugins/example-plugin/skills/hello/` as a starting point.

## Adding a new plugin

1. Create `plugins/<plugin-name>/.claude-plugin/plugin.json`:

   ```json
   {
     "name": "<plugin-name>",
     "description": "...",
     "version": "0.1.0",
     "author": { "name": "Filippo Merante Caparrotta" }
   }
   ```
2. Add skills under `plugins/<plugin-name>/skills/`.
3. Register the plugin in `.claude-plugin/marketplace.json` by adding an entry to
   the `plugins` array (the `source` is relative to the repo root, e.g.
   `"./plugins/<plugin-name>"`).

## Validating

```
claude plugin validate .                        # marketplace + all local plugins
claude plugin validate ./plugins/example-plugin # single plugin + skill
```
