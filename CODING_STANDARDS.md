# Coding standards

## Projection boundaries

When a change moves an artifact between the Claude, Codex, or pi projections, its review must include the generator’s architecture comments and the matching definitions in `GLOSSARY.md`. They must describe the post-change discovery path, source of truth, and generated outputs without retaining the replaced distribution model.

## Distribution documentation

Review every change to cross-harness distribution behavior or the prose that explains it against the manual sections of `README.md`, the matching definitions in `GLOSSARY.md`, the applicable ADRs, and the workflows or generators that implement it. Report contradictions even when generated-region checks pass: those checks do not cover the README's manual architecture prose.

## Guard rules

A rule added to `zsh-wordsplit-guard` is reviewed against every context its masked view in `hooks/scan.js` exposes (plain, double-quoted, `$(…)`, unquoted heredoc body): its tests deny or rewrite the trap in each. `rewrites.test.js` checks the rewrites mechanically. Its `allowed` cases include the contexts where neither shell splits — `[[ … ]]`, an assignment value (through `assignmentContexts` in `hooks/testing.js`, which places it after a substitution, a `case` pattern and a declaration builtin), a `case` word — and a keyword used as an argument (`echo done $x`). A rule change's PR reports the verdicts it changes from `node scripts/replay-wordsplit-guard.js --hook <hook> --base main --json [--filter <regex>]`, each wrong one fixed or argued (ADR-0005, ADR-0027).

## Mods

A mod that keeps history across sessions (`$.store`) is reviewed for the sessions it should not count: its tests cover a session that draws nowhere (`$.session.surfaces()` empty: `claude -p`, an SDK host) and a mod that never hears `session.start` (installed mid-session), and assert what was recorded, not only what was drawn.

## Widened or renamed terms

When a change widens or renames a `GLOSSARY.md` term, review greps the old term across `scripts/`, `docs/`, `.claude/skills/` and the root docs: each occurrence is updated, or still true under the narrower meaning. Report the ones that are neither.

## Mirrored upstream internals

A script or workflow step that reproduces an upstream artifact's internals (a cache path, a manifest format, a download URL) ends with an assertion that fails once the upstream stops matching, the way `scripts/check-renovate.js` guards the Renovate regexes. Review reports a mirror whose drift would only make the code fall back silently.

## External entry descriptions

A description rewritten for an external entry is checked against the upstream artifact at the pinned `sha` — the `SKILL.md` body, or a whole plugin's manifest and artifact list — not only against upstream's own description. Review reports a claim the artifact does not support.

## Validate check comments

A change to what a check run by `scripts/validate.sh` covers updates its comment there and the copy in README's command list. Review reports either one left describing the old coverage.
