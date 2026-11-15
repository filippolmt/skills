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
argument), a `for` or `select` variable, a `read` name (zsh's prompt form
`read "path?p> "` too), a `getopts` name, a `printf -v` target or its zsh twin
`print -v`, and a
bare `local path` / `typeset path`, which empties the search path. A
precommand modifier (`builtin`, `command`, `noglob`, `exec`, `nohup`) changes
nothing. A bare declaration of `status` passes: it assigns nothing. `vared`
is left alone: without a terminal it fails before assigning.

Left alone: `path+=(…)`, `path[1]=…`, and an array value that reads the search
path itself (`path=(/x $path)`, `local path=(${(s.:.)PATH})`): zsh written on
purpose. A scalar value is no such edit even when it reads the search path:
`path=$path` and `local path=$PATH` join the array into one entry and break it
the same way. The exemption covers only an assignment's value: `for path in
$path` still reassigns the name. A name that only contains the word
(`file_path`), a read (`echo $path`), quoted text and `printf %s -v path`
(where `-v` is data) never match.

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
  rule costs more than the separation. The script's deny header says zsh
  "reads" the command differently when every reason is a clobber, and
  "expands" it otherwise, so the other rules' messages are unchanged.
- The keywords that may open a command (`while`, `until`, `if`, `elif`) are
  now skipped by the word scan both rules share, so an assignment after them
  counts as one for the equals-expansion rule too.
- Text the scan masks stays invisible: `bash -c "read path"` and `bash -c
  'read path'` pass, which is right for bash; `zsh -c "read path"` passes
  too, a false negative.
