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
| `echo x; echo ${!t}; echo after` | `x`, then the abort: earlier commands stay done |
| `set -- a b; echo ${!#}` (bash: `b`) | the PID in `$!`, no error |
| `${!}`, `${!-x}`, `${!:-x}` | `$!`, as in bash |

`hooks/expansion.js` denies the first five rows as a fourth rule.

## The line

Denied: `${!` followed by a word character, and `${!#}`. Left alone: `${!}` and
`${!` followed by an operator, which read `$!` in both shells.

Each deny names the zsh form of what bash meant:

| bash | zsh |
|---|---|
| `${!t}`, `${!t:-d}` | `${(P)t}`, `${(P)t:-d}`: `(P)` replaces `!` and keeps the modifier |
| `${!T*}` | `${(k)parameters[(I)T*]}` |
| `${!h[@]}` | `${(k)h}` for keys, `{1..$#h}` for indices |
| `${!#}` | `${argv[-1]}` |

## Why with the expansion rules, and why no opt-out

The rule shares their premise and their masked view, with double-quoted text
scanned, since `"${!t}"` aborts too. It widens the *expansion trap* from a word
bash takes literally to a form bash expands differently. The zsh form above
always exists, so, as in ADR-0022, it is the opt-out.

## Consequences

- zsh expands `${!t}` in an unquoted heredoc body too, and fails that command;
  the guard skips heredoc bodies (ADR-0022), so it misses this one.
