---
status: accepted
---

# The wordsplit guard rewrites a URL query string in a bare word

Amends [ADR-0022](0022-the-wordsplit-guard-also-flags-zsh-expansions.md), which
leaves `*`, `?` and `[` in a bare word alone because their author wanted the
glob. That holds when a file matches. With none, bash passes the word on as
written and zsh aborts with `no matches found`, the same `nomatch` difference
behind the flag-value rule (#623):

    gh api repos/o/r/git/trees/HEAD?recursive=1   # zsh: no matches found

## The line

A bare word holding `?key=`, outside `${…}`, `$name[…]`, `$(…)` and backticks,
is treated like a flag value. A key is word characters, `.`, `-`, `%`, `[` and
`]`, so PHP and Rails keys (`?a[]=1`, `?ids[0]=1`) count. No one writes a
deliberate glob in that shape. Every other bare glob is still left alone, as
ADR-0022 has it: without knowing the command, an intended glob looks the same.

- **Rewritten** in single quotes when the word is literal text, as ADR-0025
  rewrites a flag value. A fragment's `#` counts as literal here: mid-word it
  is literal in both shells. Like ADR-0025, the rewrite is unconditional; it
  gives bash's reading whenever bash's own glob matches no file. The issue
  proposed `\?`; quoting is the form the flag-value rewrite already uses, with
  the same effect.
- **Denied**, naming the word with each glob escaped, when it holds an
  expansion, a quote or an escape, or starts with `~`: quoting would stop
  either expansion.
- **Denied** when an unquoted `&key=` follows. Both shells end the command at
  `&` and run it in the background, so the call is broken in bash too; the deny
  names the whole URL in single quotes. No rewrite: joining the words changes
  what bash runs.
- **Left alone**: an assignment value (`u=…?a=1`, `X=… cmd`, `export U=…`,
  `local u=…`), where zsh generates no file names; a `--name=` word, which is
  the flag-value rule's; `[[ ]]`, arithmetic and `case` patterns.

Each word inside a `$(…)`, a backtick or a heredoc body is a word of its own,
so `x=$(curl h/x?a=1)` is rewritten inside the substitution.

## Consequences

- A replay of 2383 transcript commands holding `?key=` changed 30 verdicts
  (22 rewrites, 8 denies). Each one aborts under zsh; none was a false positive.
- `isAssignment` now skips the `)` of a function definition, so
  `f() { local v==ls; }` is an assignment for the equals rule too.
