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
command-local assignment prefixes do not. Assignments after reserved words
(`then`, `do`, `else`, etc.) count too; a preceding parameter expansion in the
argument list keeps the surrounding command context. A later persistent
reassignment ends that assignment's reach. Quoted uses, arrays, explicit splits, arithmetic, `[[ … ]]`,
assignment values, `case` words and `eval` arguments remain allowed. (Amended by
[ADR-0035](0035-the-wordsplit-guard-allows-a-stored-value-echoed-to-the-tool-output.md):
an `echo`/`print` argument whose output reaches only the tool output is allowed.)

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

The hook suites pin both boundaries, including stored arguments inside plain
and double-quoted substitutions and substitutions in expanding heredocs.
`rewrites.test.js` compares the named line, IFS, array and brace fixes under zsh
against their bash readings.

## Replay

Replayed this machine's Claude transcript corpus against `main` and the changed
hooks, using `scripts/replay-wordsplit-guard.js`:

- `--hook command.js --filter '='`: 24,273 unique commands; 779 current hits
  versus 24 on `main`, with no removed hits. The 755 additions comprise 722
  substitution values and 33 quoted multi-word values.
- `--hook expansion.js --filter '\$[A-Za-z_]\w*:'`: 778 unique commands;
  69 current hits versus 20 on `main`, with no removed hits. All 49 additions
  contain the newly checked unbraced modifier form.

Substitution hits include likely single-word IDs, paths and logging arguments.
These are conservative checks explicitly included by #494, not evidence that
all 755 commands would misbehave: quote the argument to state the single-word
intent. Quoted multi-word hits require the same choice between quoting and
explicit splitting. History-modifier hits use the brace rewrite to make literal
suffixes or intentional modifiers explicit. The replay runs hooks only, never
the recorded commands; counts are a local snapshot and raw transcripts stay
private.
