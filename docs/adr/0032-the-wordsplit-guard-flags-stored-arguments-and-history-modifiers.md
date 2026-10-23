---
status: accepted
---

# The wordsplit guard flags stored arguments and unbraced history modifiers

Issue #494 found two more traps: `files=$(…); git add -- $files` passes the
whole output as one argument, and `"$N:refs/x"` applies `:r` to `N` before
appending `efs/x`. Quoting fixes the first when one argument is intended, but
only braces fix the second: `"${N}:refs/x"`.

## Stored arguments

This extends ADR-0005's argument-position exceptions and ADR-0031's assignment
reader. `command.js` denies a standalone unquoted `$name` or `${name}` argument
when an earlier standalone assignment in the same tool call gives it a quoted
value with whitespace outside expansions, or a command substitution (quoted or
unquoted, including backticks). Declaration builtins count as assignments;
command-local assignment prefixes do not. A later reassignment ends that
assignment's reach. Quoted uses, arrays, explicit splits, arithmetic, `[[ … ]]`,
assignment values, `case` words and `eval` arguments remain allowed.

A substitution's output may be one word: the hook cannot know. We accept that
extra check because stored lists are otherwise silently passed as one argument.
The deny offers `${(f)name}` for lines, `${=name}` for IFS, an array passed as
`"${name[@]}"`, or quoting for an intentional single argument. `[nosplit]` and
`ALLOW_ZSH_NOSPLIT=1` remain available. This is a syntactic check of one tool
call, not shell data-flow analysis; values from earlier calls and expansions
embedded in larger argument words remain outside this rule.

## History modifiers

`expansion.js` denies an unbraced `$name:` followed by a history modifier
(`a A c e h l p q Q r s t u x &`), optionally prefixed by `f`, `g` or `w`
(`$N:gs/a/b/` included). Its parameter view includes double quotes
and expanding heredocs, but masks literal text and escapes. The deny names
`${name}:…` for a literal suffix and `${name:…}` for an intentional modifier.
Like the other expansion rules, it has no non-split opt-out.

The hook suites pin both boundaries; `rewrites.test.js` compares the named line,
IFS, array and brace fixes under zsh against their bash readings.
