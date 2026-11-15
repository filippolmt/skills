---
status: accepted
---

# The wordsplit guard states its rule families at session start

The guard taught each rule only after the fact, in the rewrite or deny it
gave. One session took six glob rewrites and a deny before it stopped writing
the same forms (#700). `hooks/session.js` now gives a short summary as
`additionalContext`, before the first Bash call.

## The line

- **When:** `SessionStart` with `startup|clear|compact`, and every
  `SubagentStart`. A subagent runs Bash under zsh too, and it does not inherit
  the session's context. `resume` and `fork` are left out, because the
  transcript already holds the text.
- **What:** one line per **rule family**, not per rule. That is seven lines
  in about 100 words, against thirteen rules, and the text rides every session
  and subagent.
- **No `$SHELL` check.** The whole plugin assumes the Bash tool runs zsh
  (ADR-0022). The summary assumes the same.

## One source for rules and summary

The issue asked to derive the text from "the rule table `guard.js` uses". No
such table exists: `expansion.js` has a `RULES` array, while `guard.js` and
`command.js` call `deny()` directly. The link is made through the verdicts
instead:

- `families.js` holds the seven lines, keyed by family.
- Every `deny()` and `rewrite()` in `scan.js` takes the families behind it.
- Under `ZSH_GUARD_FAMILIES`, `scan.js` logs those families.
- `rewrites.test.js` already runs every suite. It fails on a verdict with no
  known family, which is a new rule without a line, and on a family no verdict
  uses, which is a dead line.

`expansion.js` also checks at load that every `RULES` entry names a known
family, so a rule no test triggers still cannot ship without its line. The
messages themselves are unchanged. A mutation that drops one rule's family
turns both checks red.

## Consequences

- The deny header no longer depends on a per-rule flag. It says "reads"
  when every reason belongs to a family in `EXPAND_NOTHING` (today only
  `special`), and "expands" otherwise (ADR-0042).
- The summary stays at 104 words, under the test's limit of 120, which leaves
  room for one more family.
- Codex and pi do not run the plugin. The pi fallback text in
  `scripts/distribution-meta.json` restates the rules by hand, and the two new
  hooks point to it. Generating it from `families.js` is #710.
