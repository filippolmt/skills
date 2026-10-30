---
status: accepted
---

# A mod is a Claude-only entry, derived from its hooks module

A **mod** loads a hooks module — a file a hooks file names under `modules` —
that runs inside Claude Code's engine, reaching everything through `$`, with no
Node and no DOM (plugin-authoring reference, Claude Code 2.1.314). No other
harness can load it. The inventory read only a hooks file's `hooks` key, so a
mod yielded no artifacts and failed with `no distribution artifacts discovered`.

## Decision

- `discoverArtifacts` emits one `hooks-module` artifact per `modules` entry,
  id from the module's path relative to the plugin root
  (`hooks-module:hooks/register.tsx`), not its array index: an index changes
  when the array is reordered and would orphan an override. A module path must
  be a string, stay inside the plugin root, exist, and carry a suffix the
  engine loads (`.ts .tsx .jsx .js .mjs .cjs .mts .cts`).
- An entry with a hooks module is **Claude-only as a whole**: every artifact
  of it is derived `unsupported` on Codex and pi, its skills and commands
  included, because they presuppose the module; publishing them alone would
  ship a package that looks complete and does nothing. A per-artifact record in
  `metadata.artifacts` still overrides, for a skill that genuinely stands alone.
- The outcome is **derived** in `scripts/distribution.js`, not written per
  entry in `distribution-meta.json`: unlike a hook, whose limits differ per
  harness and per guard, a hooks module's limit is the same fact for every mod.
- Mods stay in the parity matrix as `unsupported` rows; no Codex package, skills
  tree copy or pi filter is emitted.
- `types` (a mod's `$` contract) and `userConfig` (its `register` options) are
  manifest metadata, not artifacts.

## Considered options

- **Fold into `hook`.** Rejected: a hook is a declared event registration that
  Codex may adapt; a hooks module never travels, and sharing the kind would
  make every hook's derived outcome unsupported or every module's per-entry.
- **Kind `mod` or `module`.** Rejected: `mod` names the plugin, not the
  artifact, and *module* is the architecture vocabulary GLOSSARY.md defers to
  `codebase-design`.
- **Exclude only the module, keep the rest portable.** Rejected for the
  half-working package above.
