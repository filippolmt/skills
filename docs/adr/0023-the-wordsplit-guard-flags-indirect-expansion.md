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
| `${!T@}`, `${!T*}` | `${(@ok)parameters[(I)T*]}`, `${(ok)parameters[(I)T*]}`: `(o)` sorts, as bash does |
| `${!h[@]}`, `${!h[*]}` | `${(@k)h}`, `${(k)h}` for keys; `for ((i = 1; i <= $#h; i++))` for indices |
| `${!#}` | `${argv[-1]}` |
| `${!@}`, `${!*}`, `${!$}` | `"$@"`, `$$`, or `$!`: bash rejects the first two too |

Inside double quotes bash's `@` keeps one word per name and `*` joins them; zsh's
`(@)` flag is that `@`, so each rewrite carries it exactly when the bash form
does. Indices get a loop rather than a list: `{1..$#h}` is the literal `{1..3}`
in double quotes and `1 0` on an empty array, and `$(seq $#h)` needs an outside
command and fails in double quotes too. bash's indices start at 0 and zsh's at
1, so a list could not match anyway; what matches is what they index.

`rewrites.test.js` runs each rewrite under zsh against the bash form under bash,
quoted and on empty arrays included, and fails when a deny message has a shape
no case covers.

## Why with the expansion rules, and why no opt-out

The rule shares their premise and their masked view, with double-quoted text
scanned, since `"${!t}"` aborts too. It widens the *expansion trap* from a word
bash takes literally to a form bash expands differently. The zsh form above
always exists, so, as in ADR-0022, it is the opt-out.

## Heredoc bodies

zsh expands parameters in the body of a heredoc whose delimiter is unquoted, so
`${!t}` there fails the command and a rule-3 pattern there matches a glob group
(`${b/(x)/Y}` on `a(x)` gives `a(Y)`). `hooks/scan.js` now reads that body as
double-quoted text whose `"` is literal: the `patterns` view keeps it, minus
its `\$`, `` \` `` and `\\` escapes, and the `words` view keeps only its `$(…)`
and backticks, which run as commands of their own (`$(echo =ls)` there prints
`/usr/bin/ls`). A quoted delimiter (`<<'EOF'`, `<<"EOF"`, `<<\EOF`) keeps the
body blank. This narrows the heredoc skip of ADR-0022. The `for` rule is
unchanged: it blanks every `$(…)` anyway (ADR-0005).
