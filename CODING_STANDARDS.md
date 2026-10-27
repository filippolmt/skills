# Coding standards

## Projection boundaries

When a change moves an artifact between the Claude, Codex, or pi projections, its review must include the generator’s architecture comments and the matching definitions in `CONTEXT.md`. They must describe the post-change discovery path, source of truth, and generated outputs without retaining the replaced distribution model.

## Distribution documentation

Review every change to cross-harness distribution behavior or the prose that explains it against the manual sections of `README.md`, the matching definitions in `CONTEXT.md`, the applicable ADRs, and the workflows or generators that implement it. Report contradictions even when generated-region checks pass: those checks do not cover the README's manual architecture prose.

## Guard rules

A rule added to `zsh-wordsplit-guard` is reviewed against every context its masked view in `hooks/scan.js` exposes (plain, double-quoted, `$(…)`, unquoted heredoc body): its tests deny or rewrite the trap in each. `rewrites.test.js` checks the rewrites mechanically. Its `allowed` cases include the contexts where neither shell splits — `[[ … ]]`, an assignment value, a `case` word — and a keyword used as an argument (`echo done $x`). A new deny rule's PR reports its hits from `node scripts/replay-wordsplit-guard.js --hook <hook> --json [--filter <regex>]`, each wrong one fixed or argued (ADR-0005, ADR-0027).

## Local plugin descriptions

A local plugin's description is one text kept in three places — its `plugin.json`, its `marketplace.json` entry and the README catalog — and `gen-readme.js --check` fails when they drift. Review checks that the three agree.

## Widened or renamed terms

When a change widens or renames a `CONTEXT.md` term, review greps the old term across `scripts/`, `docs/`, `.claude/skills/` and the root docs: each occurrence is updated, or still true under the narrower meaning. Report the ones that are neither.

## External entry descriptions

A description rewritten for an external entry is checked against the upstream artifact at the pinned `sha` — the `SKILL.md` body, or a whole plugin's manifest and artifact list — not only against upstream's own description. Review reports a claim the artifact does not support.
