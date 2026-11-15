---
status: accepted
---

# The wordsplit guard flags a special parameter clobber, for `path` and `status` only

A session lost a 48-project existence check to one loop (#659):

    while read pid path br; do glab api "…" >/dev/null 2>&1 && echo "$path"; done < projects.txt

`path` is tied to `PATH` in zsh, so every later command in the loop was
`command not found`, and with stderr discarded the check reported "nothing
found". The issue proposed eight names. Measured in zsh 5.9 (`zsh -f`):

| assignment | zsh result |
|---|---|
| `path` by `read`, `for`, `NAME=`, `local path`, `printf -v`, prefix `path=x cmd` | every later command `command not found`, no other error |
| `status` by `read`, `for`, `status=…`, `local status=1` | `read-only variable: status`, the command aborts |
| bare `local status`, `typeset status` | nothing: only a later `status=…` fails |
| `pipestatus` by any form | nothing: it is not read-only, unlike what the issue said |
| `fpath`, `cdpath`, `manpath` | nothing visible in ordinary commands |
| `for argv in …` | no error; the positional parameters change |

## The line

`expansion.js` denies `path` and `status` when a command assigns them: an
assignment word (including a prefix assignment and a declaration builtin's
argument), a `for` or `select` variable, a `read` name, a `printf -v` or
`print -v` target, and a bare `local path` / `typeset path`, which empties the
search path. A bare declaration of `status` passes: it assigns nothing.

Left alone: `path+=(…)`, `path[1]=…`, and a `path` value that reads the search
path itself (`path=(/x $path)`, `${(s.:.)PATH}`): zsh written on purpose. The
exemption covers only an assignment's value: `for path in $path` still
reassigns the name. A name that only contains the word (`file_path`) and a read
(`echo $path`) never match.

## Why two names

`path` is the one silent failure, and the one seen in real traffic: a replay of
9,756 transcript commands found ten clobbers of it, every one followed by
external commands that would fail. `status` fails loudly, but each retry costs
a round trip and its rename always exists. The other names either do nothing
visible or were never observed; adding one later is a line in `SPECIAL` plus
its tests, as ADR-0022 handles a missed form.

## Why deny, with no opt-out

Renaming a variable touches every use of it, inside the loop body too; the
hook cannot see them all reliably, so it denies instead of rewriting. A rename
always exists and keeps the intent, so it is the opt-out, as in ADR-0022.

## Consequences

- The rule is an `expansion.js` rule though nothing is expanded: the script
  already parses assignments (`isAssignment`), and a fourth process for one
  rule costs more than the separation. The shared deny header now says zsh
  "runs" the command differently instead of "expands" it.
- `bash -c "read path"` in double quotes is scanned as zsh and denied, a false
  positive; single quotes and a quoted heredoc are invisible to the scan.
