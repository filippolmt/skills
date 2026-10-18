---
status: accepted
---

# The wordsplit guard rewrites literal words itself instead of denying them

On 2026-10-18 a session lost three Bash calls to the guard, each to a correct
deny: `--include=*_test.go`, `echo =====`, and a `for` loop over `$(find …)`
stored in a variable. The deny message made each rewrite immediate; the cost was
the round trip, paid every time the model writes bash out of habit.

For two of ADR-0022's rules the rewrite is mechanical. `expansion.js` now
applies it and lets the call run:

- a glob in a `--flag=value` word: the value is single-quoted,
  `--include='*.md'`;
- a word starting with `=`: the `=` is escaped, `\=====`, `[ a \== b ]`.

## The line

A word is rewritten only when it is **literal text**: fully visible in the
masked view (nothing quoted or escaped glued inside it) and made only of
`[\w.*?[\]/,:@%+=~-]`. `rewrites.test.js` runs the hook's own output under zsh
against the original under bash.

The rewrite gives bash's reading **when bash's own glob matches no file**, the
case the rule exists for. With a file named `=foo` present, bash expands
`echo =*` and the rewrite does not.

Left out, and still denied:

- `$` or a backtick: quoting would kill the expansion.
- `{`: bash brace-expands `--x=*.{md,txt}` into two words, which quoting loses.
- a quote or `\` glued on, and `!`, `^`, `#`.
- a `=` word holding a glob character. In a `case` pattern `=*` is a pattern,
  so only `\=*` keeps bash's meaning; as an argument it is literal text, so only
  `'=*'` does. The hook cannot tell which the author meant, and the deny names
  both.

The `=` is escaped rather than the word quoted because escaping is right in
every position the rule reaches, a `case` pattern included: quoting
`case $v in =ab)` would also be right, but quoting `=*)` silently turns a
pattern into a literal. zsh's `[ ]` and `test` accept `\==`, so `==` needs no
`=` rewrite.

Each deny hint is now the one a rewrite would be if it could: escape the glob
characters of a flag value (`--include=\*.$e`, `--x=\*.{md,txt}`), escape the
`=` of a word (`\=$x`). Both keep any expansion, quote or brace around them.

A call holding any hit that cannot be rewritten is denied as before, and its
rewritable hits are left for the retry. The loop rule and the parameter-pattern
and `${!…}` rules keep denying: their fixes change what the command does, or
need a choice the hook cannot make.

## What counts as a hit, adjusted

Measuring the rewrites moved two lines of ADR-0022, zsh 5.9, `zsh -f`:

- A glob flag in a `case` pattern (`case $v in --x=*)`) is no trap: zsh
  generates no file names there. Those patterns are blanked for the flag rule.
  Equals expansion does run in a `case` pattern, so the `=` rule still sees it.
- An assignment value starting with `=` expands: `v==ls` sets `/usr/bin/ls`, as
  do `a=1 v==ls cmd` and `export v==ls`. An argument does not: `echo v==ls`
  prints it as written. The `=` rule now catches the assignment forms.
- A flag value stops at `;`, `&`, `|`, `<`, `>` or a parenthesis outside a
  substitution, so `--x=*.md;echo ok` is rewritten instead of denied with a
  broken hint.

## How the rewrite runs

The hook returns `updatedInput` with no `permissionDecision`. The docs describe
`updatedInput` only beside `"allow"` (which would auto-approve every rewritten
call) or `"ask"` (which would prompt on each one, even in auto mode). Measured on
2.1.302 with `claude -p`: alone, it replaces the command, the call keeps its
normal permission flow, and permission rules are evaluated against the rewritten
command — an allow rule for the original form no longer matches.
`agent-report-guard` relies on the same behaviour for the Agent tool.
`additionalContext` tells the model what ran.

## Consequences

- If a release stops honouring `updatedInput` without a decision, the original
  command runs and zsh fails loudly (`no matches found`, `not found`) — except
  `=ls`-style words naming a real command, which print its path. That is the
  pre-guard behaviour, not a new silent failure.
- Hooks run on the original input. A deny from any other hook still wins over
  the rewrite, as an older copy of this plugin does while it is installed.
- Considered: a `SessionStart` reminder of the zsh forms. It costs context in
  every session and only lowers the odds of the mistake; the rewrite removes the
  round trip for these forms at no context cost.
