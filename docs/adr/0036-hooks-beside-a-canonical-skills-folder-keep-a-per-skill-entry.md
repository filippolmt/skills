---
status: accepted
---

# Hooks beside a canonical `skills/` keep a per-skill entry

`max-sixty/worktrunk` (#598) ships its skill twice: a standalone copy in
`skills/worktrunk`, and a mirror inside `plugins/worktrunk/`, a cohesive plugin with
`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` and activity-marker hooks
for Claude Code and Codex. CLAUDE.md's whole-plugin exception asks for one entry at
the plugin root when a per-skill entry would drop "further skills, subagents, or
commands"; ADR-0014 treats `plugins/<name>/skills/` beside a canonical `skills/` as a
mirror. Neither names hooks, so every review of #599 reopened the question.

## Decision

When upstream has a canonical `skills/` and its plugin adds only mirrors of those
skills and hooks, the entry is **per-skill**, on the canonical folder. The hooks stay
uncatalogued, and the repo's ADR-0014 row names them and how upstream installs them.

A plugin carrying skills, subagents or commands found nowhere in `skills/` still takes
a whole-plugin entry.

## Why

- Hooks run on every event of the session that installs them. Bundling them into a
  skill install changes the agent's behaviour beyond what the catalog entry
  describes; upstream already offers them as a separate opt-in.
- The canonical copy is what `check-whole-sources.js` and the pi/Codex projections
  read, so a per-skill entry keeps the three harnesses on the same files.
