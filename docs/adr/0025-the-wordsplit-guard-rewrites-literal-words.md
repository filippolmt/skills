---
status: accepted
---

# The wordsplit guard quotes literal words itself instead of denying them

On 2026-10-18 a session lost three Bash calls to the guard, each to a correct
deny: `--include=*_test.go`, `echo =====`, and a `for` loop over `$(find …)`
stored in a variable. The deny message made each rewrite immediate; the cost was
the round trip, paid every time the model writes bash out of habit.

For two of ADR-0022's rules the rewrite is mechanical: single-quote the word.
`expansion.js` now does it and lets the call run, for a `--flag=value` glob and
for a word starting with `=`, `==` included.

## The line

The word is rewritten only when it is **literal text**: fully visible in the
masked view (nothing quoted or escaped glued inside it) and made only of
`[\w.*?[\]/,:@%+=-]`. Then single quotes give exactly bash's reading, and the
differential test (`rewrites.test.js`) runs the hook's own output under zsh
against the original under bash.

Left out, and still denied:

- `$` or a backtick: single quotes would kill the expansion. The deny now names
  double quotes for it (`--include="*.$e"`, `"=$x"`).
- `{`: bash brace-expands `--x=*.{md,txt}` into two words, which quoting loses.
- `~`: bash expands it after `=`.
- a quote or `\` glued on, and `!`, `^`, `#`.

`==` is quoted rather than turned into `=`: zsh's `[ ]` and `test` accept a
quoted `==`, so one rewrite covers every position.

A call holding any hit that cannot be rewritten is denied as before, and its
rewritable hits are left for the retry. The loop rule and the parameter-pattern
and `${!…}` rules keep denying: their fixes change what the command does, or
need a choice the hook cannot make.

## How the rewrite runs

The hook returns `updatedInput` with no `permissionDecision`. The docs describe
`updatedInput` only beside `"allow"` (which would auto-approve every rewritten
call) or `"ask"` (which would prompt on each one, even in auto mode). Measured on
2.1.302 with `claude -p`: alone, it replaces the command, the call keeps its
normal permission flow, and permission rules are evaluated against the rewritten
command — an allow rule for the original form no longer matches.
`agent-report-guard` relies on the same behaviour for the Agent tool.
`additionalContext` tells the model the command ran with the quoting.

## Consequences

- If a release stops honouring `updatedInput` without a decision, the original
  command runs and zsh fails loudly (`no matches found`, `not found`) — except
  `=ls`-style words naming a real command, which print its path. That is the
  pre-guard behaviour, not a new silent failure.
- Hooks run on the original input. A deny from any other hook still wins over
  the rewrite, as an older copy of this plugin does while it is installed.
- A `[ a == b ]` written for bash no longer gets the hint to use `=`; it simply
  works.
- Considered: a `SessionStart` reminder of the zsh forms. It costs context in
  every session and only lowers the odds of the mistake; the rewrite removes the
  round trip for these forms at no context cost.
