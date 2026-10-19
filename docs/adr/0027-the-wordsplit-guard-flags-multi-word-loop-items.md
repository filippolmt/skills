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
(`"$x y"`), and any use after `done`.

## Consequences

- The list's quotes are blanked in the masked view, so the list is read from the
  raw command at the same offsets; the body is read in the masked view, where a
  quoted use is already gone.
- The body ends at the first `done`, so a use after a nested loop is a false
  negative. A false negative found in use is a one-line change plus a test.
- The opt-outs are the loop rule's: `[nosplit]` and `ALLOW_ZSH_NOSPLIT=1`.
