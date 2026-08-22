---
status: accepted
---

# What the wordsplit guard flags: a bare expansion, measured against real traffic

`zsh-wordsplit-guard` denies `for x in $var` because zsh does not word-split a
parameter expansion, so the body runs once over the whole string. The hard part
was never the mechanism — it was drawing the line around **which** expansions
inside a `for` list are worth denying. That line moved twice in one day, in
opposite directions, which is why it is recorded here rather than in a comment.

## The line

A hit is a **bare expansion**: a word of the `for` list that is one
non-splitting expansion, with nothing glued on that changes the outcome.

Denied — each of these iterates **once** in zsh 5.9:

```zsh
for x in $v            for x in ${v}          for x in ${v:-a b c}
for x in $v,           for x in $v.log        for x in ${v}x
for x in $v$w          for x in $v:$w         for f in a.log $files
```

Allowed, because the text around the expansion decides the outcome instead:

```zsh
for f in $D/*                 # glob: several words whatever SH_WORD_SPLIT says
for f in $D/opt-cold-*.log    # glob
for f in internal/$pkg/*.go   # glob
for f in $D/a.log $D/b.log    # path separator: a word built to BE one word
```

So the exemption is **a glob metacharacter (`*?[`) or a path separator (`/`)
outside the braces**, and nothing wider.

## Why it is drawn by measurement

The first cut flagged any non-splitting expansion in the list. Replaying it over
real traffic — every `Bash` command carrying a `for … in` from past session
transcripts, 1588 unique commands — gave **12 denials, 5 of them wrong**, and
all five were the glob/path shape above. A guard that is wrong two times in five
teaches the reflex of setting `ALLOW_ZSH_NOSPLIT=1` and never unsetting it,
which costs more than the bug it catches.

The second cut exempted **any** non-blank neighbour. That was too wide in the
other direction: it reopened `$v,`, `$v.log`, `$v$w`, `${v}x` and `$v:$w`, which
are the original bug wearing punctuation. Review caught it before the branch
merged. The rule above is the third cut, and it keeps the 7 true denials from the
replay — `$ids`, `$exported`, `$M`, each a command substitution's multi-line
output looped over unsplit — while allowing all 5 shapes that were denied
wrongly.

## Consequences

- The corpus is this machine's session history, so the replay is not committed
  and not in CI. What CI keeps is the conclusion: `guard.test.js` pins every
  shape from both lists above.
- The exemption is syntactic, so `for f in $D/*` is allowed even when `D` holds a
  path with spaces. That is correct for the wrong reason — globbing splits the
  result anyway — and it means the guard says nothing about quoting. The same
  syntax-only reading allows `for d in $dirs/bin`, which does run once: the path
  separator says "one word by intent" whether or not that intent was there.
- A `PreToolUse` hook sees one command, so an array assigned in an EARLIER call
  (`arr=(x y)` in one, `for x in $arr` in the next) is denied wrongly. Within a
  single command the assignment is honoured. The deny is noise, but it carries
  the right answer anyway: `"${arr[@]}"` is the form to use in both cases.
- `for x in $EMPTY` (unset) is denied although zsh runs zero iterations. A static
  guard cannot know the value, and a loop over an unset variable is worth a
  second look regardless.

These three came out of a differential test — 39 `for`-list shapes, each executed
in zsh 5.9 to count real iterations, compared against the guard's verdict. The
other six mismatches it surfaced were the metric's fault, not the guard's:
`"$v"`, `${(f)v}`, `${(s.,.)v}` and `$arr[1]` iterate once because that is what
they ask for, and `for x in "$v" $w` or `$v $v` iterate more than once while
still hiding an unsplit expansion. Iteration count alone does not decide a hit;
intent does.
- Widening the exemption again needs the same evidence: a replay showing the
  denials it removes were wrong. Narrowing it back is cheap, so a false negative
  found in use is a one-line change plus a test.
