# Overlays

A **vendored copy** in `skills/` is byte-identical to its upstream at the
`sha` the catalog entry pins. When a skill needs a change for pi or Codex, the
change lives here as a patch instead of being made in the copy — an edit made
*in* the copy is a fork, not an overlay.

- One file per skill: `<skill-name>.patch`, named after the skill's directory in
  the tree.
- The diff is relative to the **skill's own directory**: `git apply` runs from
  inside the vendored copy, so paths look like `SKILL.md`, not
  `skills/tdd/SKILL.md`.
- `node scripts/gen-skills-tree.js` copies first and applies the patch after,
  then records it in that skill's `SOURCE.md`.

The point is the failure mode. When upstream changes the lines a patch touches,
`git apply` **fails** and the generation stops. A replacement file would keep
working while silently freezing the skill at a months-old upstream — the same
silent-drift class as the Renovate seam this repo documents elsewhere.

This directory is empty on purpose: none of the vendored skills needs adaptation
today, and an overlay that is not needed is a fork waiting to happen.
