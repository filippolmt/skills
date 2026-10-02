---
status: accepted
supersedes: ADR-0002, ADR-0003, ADR-0004, ADR-0006, ADR-0009, ADR-0013
---

# Remove `mode-router` and the two modes from the catalog

`mode-router` existed so that `caveman` and `ponytail` never both started on
their own: a hook classified every prompt and kept exactly one mode per context,
with a switch notice, a veto and a carryover around it. With `caveman` no longer
wanted, one mode is left and there is nothing to route.

**All three entries leave the catalog**: the local `mode-router` plugin and the
`caveman` and `ponytail` git-subdir entries. `ponytail` is installed straight from
its upstream, which ships a whole plugin with its own lifecycle hooks for Claude
Code and Codex and a pi extension — more than a per-skill entry here could carry.

## Consequences

- Breaking for anyone with these installed: they uninstall the three plugins and,
  for `ponytail`, add the upstream marketplace (`DietrichGebert/ponytail`).
- The README's Modes table is gone; `gen-readme.js` no longer reads the router's
  manifest.
- The *Mode router* section leaves `CONTEXT.md`. The ADRs that decided the
  router's behaviour are superseded here and kept as history; the name-collision
  lesson of ADR-0004 still stands and `check-name-collisions.js` still enforces it.
- The next regeneration drops `skills/caveman` and `skills/ponytail` from the tree.
  A pi filter naming `+skills/ponytail` on this package stops matching.

## Considered options

- **Keep `mode-router` forced to `ponytail`** via its control file. Leaves
  `caveman` installed as a dependency that never loads — not a removal.
- **Turn `ponytail` into a whole-plugin entry (`"path": "."`).** Upstream mirrors
  its skills under `.openclaw/skills/`, so the tree generator would need to learn
  to skip mirror folders. Not worth it for a plugin installable from its own
  marketplace on every harness.
