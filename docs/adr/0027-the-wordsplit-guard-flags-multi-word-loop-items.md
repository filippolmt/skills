---
status: accepted
---

# The wordsplit guard flags a multi-word loop item used unquoted

ADR-0005 leaves an unquoted `$var` in argument position alone: it is usually one
word and correct, and denying it would teach `ALLOW_ZSH_NOSPLIT=1`. One argument
position is in scope anyway (issue #456):

```zsh
for c in "tests/a.py /nope" "tests/b.py /nope /nope"; do python3 $c; done
```

zsh does not split `$c`, so python3 gets `tests/a.py /nope` as one file name and
fails for every item. The source proves the intent: a quoted literal holding
whitespace in a `for` list exists only to be split again in the body. That is
the same precision argument as `for x in $v` — the construct means several words
by definition — so the guard denies it like the loop rule.

## The line

Denied: in `for NAME in <list>; do <body>; done`, at least one list word is a
quoted literal (single quotes, or double quotes with no `$`, backtick or escape)
holding whitespace, and the body uses `$NAME` or `${NAME}` outside double quotes.

Allowed: a list of single-word items (`for f in "a.txt" "b.txt"`), a quoted use
(`"$c"`), an explicit split (`${=c}`), a list word that is not literal text
(`"$x y"`), any use after `done`, and a use where neither shell splits:
inside `[[ … ]]`, as an assignment value (`x=$c`), as the `case` word. The issue
asked for every unquoted use; those three are one word by intent, so denying
them would be the noise ADR-0005 measured against. Also allowed: an argument of
`eval`, which parses it again and so splits it, and a quoted literal inside a
command substitution in the list (`$(find -newermt '-15 minutes')`), which is
that command's argument, not an item.

## Measured

`scripts/replay-wordsplit-guard.js` replayed the 9086 unique `Bash` commands
holding a `for` from this machine's transcripts. The rule added 54 denials to
the loop rule's 33. Three were wrong — the `eval` and substitution shapes above,
now allowed — and the other 51 are the trap itself: 29 of them `set -- $p` over
items like `"gitlab-runner 0.92.1 0.93.0"`, which in zsh sets only `$1`, and the
rest a CLI run as `$B $c` or `cmd $c` over multi-word items. Under the Bash
tool's zsh each of those runs with the whole item as one word. The replay is
local, like ADR-0005's; its count is a snapshot of this machine's history.

## Consequences

- The body ends at the first `done`, so a use after a nested loop is a false
  negative. A false negative found in use is a one-line change plus a test.
- The opt-outs are the loop rule's: `[nosplit]` and `ALLOW_ZSH_NOSPLIT=1`.
