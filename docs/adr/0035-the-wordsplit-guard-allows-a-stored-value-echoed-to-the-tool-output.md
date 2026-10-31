---
status: accepted
---

# The wordsplit guard allows a stored value echoed to the tool output

Issue #570: `sha=$(git rev-parse HEAD) && echo $sha && glab mr merge … --sha "$sha"`
was denied by ADR-0032's stored-argument rule for `echo $sha` alone, and the deny
dropped the whole compound command, the merge included. The rule had no
exception for `echo` or `print`; a test asserted the deny on purpose.

## Decision

`command.js` allows an unquoted stored argument of `echo` or `print` when that
output reaches only the tool output. Both builtins join their arguments with
spaces, so on the tool output zsh and bash differ in whitespace alone: a deny
there costs a retry and protects nothing.

The deny stays when stdout goes to a consumer, because there the consumer reads
other data than in bash: `v=$(printf 'a\nb'); echo $v | wc -l` counts 2 lines
in zsh and 1 in bash. A consumer is:

- a pipe (`|`, `|&`, not `||`) or a stdout redirection (`>f`, `1>f`, `>>f`,
  `&>f`, `>|f`) after the argument; `2>f`, `2>&1` and `>&2` leave stdout on the
  tool output and do not count;
- an enclosing substitution: `$(…)`, backticks, `<(…)`, `>(…)`;
- an enclosing group — `( … )`, `{ … }`, `if`/`for`/`while`/`until`/`select`/`case`
  — whose closing word (`)`, `}`, `fi`, `done`, `esac`) pipes or redirects stdout.

The issue proposed exempting `echo`/`print` everywhere; that would let
`echo $files | xargs …` through, the case where the shells hand over different
data. Option-looking values (`v='-n x'; echo $v` prints `x` without a newline in
bash, `-n x` in zsh) stay allowed, as the issue asked: the difference is on the
tool output only.

A function body is read as a group, so `f() { echo $v; }; x=$(f)` is allowed: the
check does not follow calls. Loop-item rules in `guard.js` are unchanged.

## Replay

Replayed this machine's Claude transcript corpus with `scripts/replay-wordsplit-guard.js
--hook command.js --json --filter '='` against `main` and the changed hook: 27,104
unique commands, 744 denies on `main`, 519 now; 225 removed, none added. A sample
of the removed ones prints a polling status, a SHA or a count to the tool output;
the remaining ones with `echo $x` also pass the value unquoted to another command.
