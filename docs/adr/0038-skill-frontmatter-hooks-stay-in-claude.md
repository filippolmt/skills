---
status: accepted
---

# Skill frontmatter hooks stay in Claude

A `SKILL.md` frontmatter can carry a `hooks:` key: Claude Code registers those
hooks while the skill is active. taste-skill v2.5.1 (#620) added a `Stop` hook
there that runs its finish gate, searching for `gate.mjs` under
`${CLAUDE_PLUGIN_ROOT:+…}` among other folders. The projections copied the
frontmatter verbatim, so `validatePortableRuntime` (ADR-0021) rejected the
skill as a whole for a reference that only Claude ever executes.

## Decision

- `discoverArtifacts` emits one `hook` artifact per registration of a skill's
  frontmatter hooks, with the same id shape as a hooks file
  (`hook:SKILL.md#Stop[0]`). Like any hook, it has no derived outcome: each
  needs its Codex and pi decision in `distribution-meta.json`, and it shows as
  its own row in the parity matrix.
- Projections drop the `hooks:` block from every projected `SKILL.md` (pi tree,
  Codex packages), after overlays; `SOURCE.md` records the drop. Claude keeps
  it, since Claude installs from upstream by reference.
- `validatePortableRuntime` reads a `SKILL.md` without its frontmatter hooks.
  A `CLAUDE_PLUGIN_ROOT` anywhere else, references included, still fails.
- The reader is line-based, not a YAML parser: a `hooks:` it cannot read (flow
  style, no registration) fails instead of passing silently.
- Codex gets such a hook only as `adapted`, from an upstream Codex hook file
  (`sourcePath`), as impeccable does. Without one it is `unsupported`, and the
  fallback names upstream's manual setup.

Prose in a reference that describes the Claude hook is not a hook: it takes an
overlay, as taste-skill's `references/gate.md` does
(`overlays/design-taste-frontend.patch`).

## Considered options

- **Declare the whole skill unsupported.** Rejected: it drops a skill that
  works in Codex and pi for a hook those harnesses never read.
- **An overlay removing the frontmatter block.** Rejected: the hook's command
  line changes with most releases, so every Renovate bump would fail on
  overlay drift; the drop is mechanical and needs no review per release.
- **Ignore any `CLAUDE_PLUGIN_ROOT` guarded by `${…:+…}`.** Rejected: a guarded
  reference in a skill's instructions is still a Claude dependency, and the
  hook would keep reaching harnesses that cannot run it.
