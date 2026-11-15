---
status: accepted
---

# The wordsplit guard escapes a path glob that matches nothing

Amends [ADR-0022](0022-the-wordsplit-guard-also-flags-zsh-expansions.md),
which leaves a bare glob alone because its author wanted it. That holds when a
file matches. With none, zsh's `nomatch` aborts the whole command line and
bash passes the word on (#701). Measured in zsh 5.9, in a directory holding
only `a.txt`:

| command | bash | zsh |
|---|---|---|
| `grep x a.txt *.md` | `a.txt:x`, then `*.md: No such file`, rc 2 | `no matches found: *.md`, rc 1, nothing from `a.txt` |
| `grep x a.txt \*.md` | same as bash | same as bash |
| `grep x a.txt *.md(N)` | — | `a.txt:x`, rc 0; alone, `grep x *.md(N)` reads stdin |

## The line

A word in the call's **first command** (before any `;`, `&`, `|` or newline),
unquoted and literal (word characters and `.,:@%+/-`, a leading `~`), holding
`*`, `?` or `[`, is matched by zsh itself in the payload's `cwd`. One that
matches nothing is rewritten with each glob character escaped: bash's reading,
`~` still expanded. A word with `=` belongs to the flag-value, query and equals
rules; a `case` pattern and `[[ … ]]` generate no file names. A `for` list in
the first command counts: bash iterates once over the literal word, and so
does the rewrite.

- **Escape, not `(N)`**, which the issue proposed: the null glob drops the
  word, so `ls *.md(N)` lists the whole directory and a lone `grep x *.md(N)`
  hangs on stdin.
- **First command only.** zsh expands a glob when it reaches that command, so a
  file an earlier command creates (`touch b.md; ls *.md`, a `cd`, a `git
  checkout`) would be missed by a check made before the call runs.
- **zsh decides the match**: `zsh -f` runs `a=( ${~p}(N) )` per word in the
  cwd. `${~p}` globs the parameter's value and expands its `~` without running
  a `$(…)` in it. Node's `fs.globSync` differs from zsh on dotfiles, `**` and
  bracket classes. No answer (no zsh, a missing cwd, a 2-second timeout) leaves
  every word alone.

A rewrite keeps the meaning, so there is no opt-out (ADR-0022).

## Consequences

- The hook now reads the payload's `cwd`, falling back to its own working
  directory. The test harness passes a missing directory by default, so the
  rule stays silent unless a test gives it a fixture.
- `zsh -f` ignores the user's options: with `nullglob` or `nonomatch` set in
  their shell, zsh would not abort, and the rewrite turns their reading into
  bash's.
- `scripts/replay-wordsplit-guard.js` passes each command's recorded cwd, so
  this rule's replay hits reflect the disk as it is now, not when the command
  ran: 48 rewrites over 60,250 commands at the time of writing.
