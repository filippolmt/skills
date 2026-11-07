---
status: accepted
---

# Skill frontmatter hooks stay in Claude

Amends [ADR-0021](0021-project-native-codex-plugins-from-the-catalog.md), whose
source validation now reads a `SKILL.md` without its frontmatter hooks, and
[ADR-0010](0010-vendor-a-shared-skills-tree-on-main.md), whose vendored copy is
byte-identical to upstream except for that block.

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
- Source validation reads a skill's `SKILL.md` without its frontmatter hooks.
  A `CLAUDE_PLUGIN_ROOT` anywhere else, references included, still fails.
- Generated validation reads every projected file as is, and rejects a
  `SKILL.md` that still carries frontmatter hooks: a projection path that
  forgets the drop fails instead of leaking.
- `frontmatterHooks` in `distribution.js` is pure (registration ids and the text
  without the block). Two projection steps write it: `vendorSkill` for an
  upstream copy, after its overlay, and `copySkill` for every other skill copy.
- The reader is line-based, not a YAML parser: a `hooks:` it cannot read (flow
  style, no registration) fails instead of passing silently.
- Codex gets such a hook only as `adapted`, from an upstream Codex hook file
  (`sourcePath`), as impeccable does. Without one it is `unsupported`, and the
  fallback names upstream's manual setup.

Prose in a reference that describes the Claude hook is not a hook: it takes an
overlay, as taste-skill's `references/gate.md` does
(`overlays/design-taste-frontend.patch`). The overlay rewrites only the
sentences naming `CLAUDE_PLUGIN_ROOT`, so it drifts only when upstream touches
them.

## Considered options

- **Declare the whole skill unsupported.** Rejected: it drops a skill that
  works in Codex and pi for a hook those harnesses never read.
- **An overlay removing the frontmatter block.** Rejected: the hook's command
  line changes with most releases, so every Renovate bump would fail on
  overlay drift; the drop is mechanical and needs no review per release.
- **Ignore any `CLAUDE_PLUGIN_ROOT` guarded by `${…:+…}`.** Rejected: a guarded
  reference in a skill's instructions is still a Claude dependency, and the
  hook would keep reaching harnesses that cannot run it.
