---
status: accepted
---

# The wordsplit guard flags bash's `${v@…}` transformations, with no opt-out

On 2026-10-10 a session wrote a heredoc to a file and quoted a value with
`${v@Q}` in the same command (issue #388). zsh aborted with `bad substitution`,
the file stayed empty, and the next step failed with an unrelated-looking
`No tests found`. Measured in zsh 5.9, `zsh -f`, against bash 5.2.15:

| command | zsh result |
|---|---|
| `${v@Q}`, `${v@E}`, `${v@P}`, `${v@A}`, `${v@a}`, `${v@U}`, `${v@u}`, `${v@L}`, `${v@K}` | `bad substitution`, the shell aborts |
| `"${v@Q}"`, `${a[@]@Q}`, `${@@Q}`, `${1@Q}` | `bad substitution` |
| `${v@}`, `${v@x}`, `${#v@Q}` | `bad substitution`; bash rejects them too |
| `echo x; echo ${v@Q}; echo after` | `x`, then the abort |

`hooks/expansion.js` denies them as a fifth rule.

## The line

Denied: `${`, an optional `#`, a name, a positional or `@ * ? $ -`, an optional
subscript, then `@`. zsh has no `@` operator after a parameter, so every such
form aborts and the rule cannot be wrong on text zsh evaluates. It reads the
same view as `${!…}` (ADR-0023): double quotes and unquoted heredoc bodies
included, single quotes and quoted heredocs not.

Each deny names the zsh form where one exists:

| bash | zsh |
|---|---|
| `${v@Q}`, `"${a[@]@Q}"`, `"${@@Q}"` | `${(qq)v}`, `"${(@qq)a}"`, `"${(@qq)argv}"` |
| `"${a[*]@Q}"` | `"${(j: :)${(@qq)a}}"`: `"${(qq)a}"` joins before quoting, `'a b c'` |
| `${v@E}` | `${(g::)v}` |
| `${v@U}`, `${v@L}` | `${(U)v}`, `${(L)v}` |
| `${v@u}` | `${(U)v[1]}${v[2,-1]}`: `(C)` capitalises every word |
| `${v@P}` | `${(%)v}`, with zsh's prompt escapes (`%n`) in place of bash's (`\u`) |
| `${v@A}`, `${v@a}`, `${h[@]@K}`, `${h[@]@k}`, `${a[@]@u}` | none: python or sed |
| any other letter, or `${#v@Q}` | none: bash aborts too |

`rewrites.test.js` runs each named form under zsh against the bash form under
bash, quoted and on an empty array included. `@P` is compared on plain text
only, since the escapes differ by design. The rows with no zsh form are checked
for their message alone.

## Why a deny and not a rewrite

ADR-0025 rewrites a **literal word** whose fix is quoting or an escape. These
are expansions, and only `@U` and `@L` have an exact flag; the rest need a
choice (`@P`'s escapes, `@Q`'s word joining) or have no equivalent. One rule
that always denies keeps the line ADR-0025 drew, at the cost of a round trip
on a form that is rare.

## Why no opt-out

As in ADR-0022 and ADR-0023: no use of the form survives zsh, so there is no
deliberate use to let through. The named form is the way through.
