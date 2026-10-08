---
status: accepted
---

# The wordsplit guard also flags three zsh expansions, with no opt-out

One session on 2026-10-08 lost three commands to zsh, each one a word that bash
would have taken literally. Measured in zsh 5.9 with default options:

| command | zsh result |
|---|---|
| `echo =====` | `==== not found` — equals expansion |
| `echo =ls` | `/usr/bin/ls`, no error |
| `[ a == b ]`, `test a == b` | `= not found` |
| `grep -rn --include=*.md x .` | `no matches found: --include=*.md`, even with `a.md` present: the pattern is the whole word |
| `${b/(issue tracker, domain docs)/X}` on `see (issue tracker, domain docs)` | `see (X)`: the parentheses are a glob group, no error |

`zsh-wordsplit-guard` now denies all three in a second hook script,
`hooks/expansion.js`, beside `guard.js` in the same `PreToolUse` group.

## The lines

- **Equals expansion**: an unquoted word starting with `=` followed by anything.
  Left alone: a lone `=`, `=(cmd)` (process substitution, written on purpose),
  `X=1`, `a==b`, `--x=y`, and `==` inside `[[ ]]` or arithmetic.
- **Glob in a flag value**: a `--name=value` word with `*`, `?` or `[` outside
  quotes, `${…}` and a `$name[…]` subscript. A short flag with a glob glued on
  (`-I*.zz`) fails the same way but is left alone: it is indistinguishable from
  a deliberate glob without knowing the command.
- **Parentheses in a parameter pattern**: an unescaped `(` or `)` in the pattern
  of `${v/…}`, `${v//…}`, `${v:/…}`, `${v#…}`, `${v%…}`, including inside double
  quotes and after a nested `${…}`. A parenthesis inside a bracket class (`[(]`)
  is literal, the bracket form of the escape, and passes.
  `*`, `?` and `[` are left alone because they mean the same thing in bash, so
  their author wanted the glob. A pattern holding `|` or `(#` is zsh syntax
  written on purpose and passes, even though `(#b)` does nothing without
  `extendedglob`.

## Why in this plugin

A second guard would keep the name accurate, at the cost of a second install
for one shell's traps. Here the shared condition is the plugin's own premise —
the Bash tool runs zsh — so the rules live together. A separate script keeps
the `for` rule and its opt-out apart; both scripts read the command through one
masked view in `hooks/scan.js`.

## Why no opt-out

`[nosplit]` and `ALLOW_ZSH_NOSPLIT=1` cover the `for` rule only. Each new rule's
deny names a rewrite that always exists and keeps the author's intent: quote the
word, escape the parenthesis, or write `${commands[name]}` for a command path.
That rewrite is the opt-out. Sharing the existing one would teach
`ALLOW_ZSH_NOSPLIT=1`, which silences the `for` rule too — the cost ADR-0005
was drawn to avoid.

## Consequences

- Unlike ADR-0005, no replay over real traffic backs these lines: reading the
  session transcripts was not available when they were written. A false
  positive found in use is a one-line change plus a case in `expansion.test.js`.
- The masked view skips single-quoted text, so `bash -c '…'` is invisible and
  so is `zsh -c '…'`. A `$(…)` is zsh, and is scanned even inside double quotes.
- A heredoc body is skipped up to its terminator line, and the command after it
  is scanned again. That also widens the `for` rule: before this change
  `guard.js` stopped at the first `<<` and missed a loop after the heredoc.
- The coverage of rule 1 is wider than "argument position": `=ls` after `<<<`,
  a pipe or inside `arr=(…)` is denied too. zsh expands every one of them, so
  the verdict is right wherever it lands.
