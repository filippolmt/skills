---
status: accepted
---

# The wordsplit guard flags bash's `${!…}`, with no opt-out

On 2026-10-09 a loop of non-idempotent POSTs read each title through bash
indirection, `t="T$n"; … title="${!t}"`, and zsh aborted it partway with
`bad substitution`. Measured in zsh 5.9, `zsh -f`:

| command | zsh result |
|---|---|
| `${!t}`, `"${!t}"`, `${!t:-d}`, `${!1}` | `bad substitution`, the shell aborts |
| `${!T*}`, `${!T@}` (bash: names with prefix `T`) | `bad substitution` |
| `${!arr[@]}` (bash: keys or indices) | `bad substitution` |
| `${!@}`, `${!*}`, `${!$}` | `bad substitution` |
| `echo x; echo ${!t}; echo after` | `x`, then the abort: earlier commands stay done |
| `set -- a b; echo ${!#}` (bash: `b`) | the PID in `$!`, no error |
| `${!}`, `${!-x}`, `${!:-x}` | `$!`, as in bash |

`hooks/expansion.js` denies the first six rows as a fourth rule.

## The line

Denied: `${!` followed by a word character, `@`, `*` or `$`, and `${!#}`. Left
alone: `${!}` and `${!` followed by an operator, which read `$!` in both shells.

Each deny names the zsh form of what bash meant:

| bash | zsh |
|---|---|
| `${!t}`, `${!t:-d}` | `${(P)t}`, `${(P)t:-d}`: `(P)` replaces `!` and keeps the modifier |
| `${!T*}` | `${(ok)parameters[(I)T*]}`: `(o)` sorts, as bash does |
| `${!h[@]}` | `"${(@k)h}"` for keys; `$(seq $#h)`, unquoted, for indices |
| `${!#}` | `${argv[-1]}` |
| `${!@}`, `${!*}`, `${!$}` | `"$@"`, `$$`, or `$!`: bash rejects the first two too |

The index form avoids two traps of `{1..$#h}`: in double quotes it is the literal
`{1..3}`, and on an empty array it yields `1 0`.

## Why with the expansion rules, and why no opt-out

The rule shares their premise and their masked view, with double-quoted text
scanned, since `"${!t}"` aborts too. It widens the *expansion trap* from a word
bash takes literally to a form bash expands differently. The zsh form above
always exists, so, as in ADR-0022, it is the opt-out.

## Heredoc bodies

zsh expands parameters in the body of a heredoc whose delimiter is unquoted, so
`${!t}` there fails the command and a rule-3 pattern there matches a glob group
(`${b/(x)/Y}` on `a(x)` gives `a(Y)`). The `patterns` view in `hooks/scan.js`
now keeps that body, minus its `\$`, `` \` `` and `\\` escapes; a quoted
delimiter (`<<'EOF'`, `<<"EOF"`, `<<\EOF`) keeps it blank. This narrows the
heredoc skip of ADR-0022 for rules 3 and 4; the `words` view, and with it the
`for` rule and rules 1–2, still skips every body, since a body undergoes no word
splitting, equals expansion or globbing.
