---
status: accepted
---

# Whole-plugin entries cover commands, and their root may be the repo root

Default granularity is one entry per `SKILL.md`. The whole-plugin exception was
written against `wshobson/agents`, where a plugin folder bundles **subagents**
alongside skills, so both CLAUDE.md ("bundles several skills and/or subagents")
and the `/add-external-skill` step 2 ("and you want its subagents too") name the
same two artifact kinds.

`cathrynlavery/diagram-design` fits neither clause and still needs the exception.
It ships **one** skill, **zero** subagents, **five** commands (`doctor`,
`export-diagram`, `import-drawio`, `import-mermaid`, `profile`), and its
`.claude-plugin/plugin.json` sits at the **repo root**. Read literally, the rule
says to add a per-skill entry at `skills/diagram-design` — which validates,
installs, and silently drops all five commands. That is exactly the loss the
exception exists to prevent; only the artifact kind is new.

## Decision

- The exception's trigger is **what a per-skill entry would drop**, not which
  artifact kind does the dropping. Several skills, subagents, **or commands** —
  any of them makes the plugin root the entry's `path`.
- A plugin root that is the repo root is written `"path": "."`, never `""`. Both
  Renovate `customManager` regexes require a non-empty path
  (`"path":\s*"[^"]+"`); `.` satisfies them, `""` matches neither, and an entry
  matching neither manager is never updated again — silently, with no error
  (CLAUDE.md, "The Renovate seam").
- Such an entry vendors the **whole** upstream repo into the install: `docs/`,
  CI config, sibling host manifests (`.codex-plugin/`, `.factory-plugin/`), and
  upstream's own `marketplace.json`. Accepted — nothing on the install path
  reads a nested catalog, and the alternative is shipping a plugin with its
  commands cut off.

## Considered options

- **Per-skill entry at `skills/diagram-design`.** Follows the letter of the
  rule, passes every check, and loses five commands with nothing reporting it.
  Rejected: a check that cannot fail is not a reason to ship less.
- **One entry per artifact.** `git-subdir` addresses a folder, and a
  `commands/` folder carries no manifest, so the commands have no path of their
  own to point at. Not available.
- **Leave the rule alone and treat this entry as a one-off.** Rejected: the next
  agent hits the same conflict and reopens it, which is what this file is for.

## Consequences

- The rule now turns on a loss, not on a list of artifact kinds, so a future
  upstream bundling something else again (hooks, MCP servers) is covered without
  another amendment.
- `scripts/check-name-collisions.js` compares catalog names and **local**
  artifacts. It does not see the command names inside an external plugin, so
  generic ones — `diagram-design` ships `/doctor` and `/profile` — are only
  distinguished by the harness namespacing them under their plugin. A future
  collision there is ours to notice, not the script's.
- `"path": "."` is the first repo-root path in the catalog. Renovate keeps
  updating it, but it sets a precedent worth citing rather than rediscovering.
