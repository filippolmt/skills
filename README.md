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

## Adding this marketplace

Register it once, then it shows up in `/plugin`:

```
/plugin marketplace add filippolmt/skills
```

(Any git remote works too, e.g. `/plugin marketplace add https://github.com/filippolmt/skills`.)

## Installing skills (individually)

Each skill is its own plugin, so you only install the ones you want:

```
/plugin install tdd
/plugin install grill-me
```

Then invoke them namespaced: `/tdd:tdd`, `/grill-me:grill-me`. Model-invoked
skills (e.g. `grilling`) are triggered by Claude automatically when relevant.

To refresh after upstream updates:

```
/plugin marketplace update filippo-skills
```

## Available skills

Snapshot of the catalog — the source of truth is
[`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json).

**Local:** `example-plugin` — template plugin with one example skill.

### [mattpocock/skills](https://github.com/mattpocock/skills) — engineering & productivity

| Skill | What it does |
|---|---|
| `ask-matt` | Ask which skill or flow fits your situation. |
| `diagnosing-bugs` | Diagnosis loop for hard bugs and performance regressions. |
| `grill-with-docs` | Relentless interview to sharpen a plan, producing ADRs and a glossary as it goes. |
| `triage` | Move issues and external PRs through a triage state machine into agent-ready briefs. |
| `improve-codebase-architecture` | Scan a codebase for deepening opportunities and grill through the one you pick. |
| `setup-matt-pocock-skills` | Configure a repo for these skills — issue tracker, triage labels, domain docs. |
| `tdd` | Test-driven development. |
| `to-issues` | Break a plan/spec/PRD into independent issues as tracer-bullet vertical slices. |
| `to-prd` | Turn the current conversation into a PRD and publish it to the issue tracker. |
| `implement` | Implement a piece of work based on a PRD or set of issues. |
| `prototype` | Build a throwaway prototype to answer a design question. |
| `research` | Investigate a question against primary sources; capture findings as Markdown. |
| `domain-modeling` | Build and sharpen a project's domain model. |
| `codebase-design` | Shared vocabulary for designing deep modules. |
| `code-review` | Review changes since a fixed point on standards + correctness axes. |
| `grill-me` | Relentless interview to sharpen a plan or design. |
| `grilling` | Interview the user relentlessly about a plan or design. |
| `handoff` | Compact the conversation into a handoff doc for another agent. |
| `teach` | Teach the user a new skill or concept within the workspace. |
| `writing-great-skills` | Reference for writing predictable skills — vocabulary and principles. |

### [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) — frontend design & image-gen

| Skill | What it does |
|---|---|
| `taste-skill` | Anti-slop frontend skill for landing pages, portfolios, and redesigns. |
| `taste-skill-v1` | Original v1 taste-skill, preserved for projects pinned to its behavior. |
| `redesign-skill` | Upgrade existing sites/apps to premium quality without breaking them. |
| `soft-skill` | Design like a high-end agency — fonts, spacing, shadows, animations. |
| `minimalist-skill` | Clean editorial interfaces: warm monochrome, flat bento grids. |
| `brutalist-skill` | Raw mechanical UI: Swiss print × military terminal aesthetics. |
| `brandkit` | Generate brand-guideline boards, logo systems, and identity decks. |
| `stitch-skill` | Semantic design-system `DESIGN.md` files for Google Stitch. |
| `image-to-code-skill` | Generate a design image, analyze it, then build the site to match. |
| `imagegen-frontend-web` | Generate premium, conversion-aware website design references. |
| `imagegen-frontend-mobile` | Generate premium app-native mobile screen concepts and flows. |
| `gpt-tasteskill` | UX/UI + GSAP motion engineering with editorial typography rules. |
| `output-skill` | Override LLM truncation — enforce complete, placeholder-free output. |

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
