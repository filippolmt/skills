---
status: accepted
---

# The wordsplit guard flags a stored command

> [ADR-0032](0032-the-wordsplit-guard-flags-stored-arguments-and-history-modifiers.md)
> extends the assignment reader to stored arguments, including substitutions.
> The argument-position exclusions below describe the original rule.

ADR-0005 keeps an unquoted `$var` outside a `for` list out of scope: it is
usually one word and correct. Issue #388 found a second place where the source
proves several words were meant, in **command position**:

```zsh
DCF="docker compose -f a.yml -f b.yml"; $DCF build nginx
# zsh: command not found: docker compose -f a.yml -f b.yml
```

bash splits the value into a command and its arguments; zsh looks the whole
value up as one command name. A quoted value holding whitespace, run as a
command, exists only to be split again, the same precision argument as
ADR-0027's loop items. `hooks/command.js` denies it, a third hook beside
`guard.js` and `expansion.js` sharing their masked view and the loop rules'
opt-out.

## The line

Denied: an unquoted `$NAME` or `${NAME}` as the first word of a command, where
the same command earlier assigns `NAME=` a quoted value with whitespace outside
any expansion. The first word is read after the start, a newline, `;`, `&`,
`|`, `(` or `{`, past any assignment prefix (`X=1 $DC`), reserved word (`then`,
`do`, `else`, `elif`, `if`, `while`, `until`, `!`) and precommand modifier
(`time`, `exec`, `nohup`, `command`, `noglob`, `sudo`, `env`) with its options;
the options taking an argument are named (`sudo -u root`, `env -u NAME`,
`exec -a name`). The assignment is a command of its own, a declaration
builtin's included (`export`, `local`, `typeset`, `declare`, `readonly`):
`echo DC="a b"` is an argument, and `DC="a b" cmd` sets `DC` for `cmd` only, so
neither is read, nor is `DC="a b" $DC`, whose `$DC` reads the value from
before.

Allowed:

- a single-word value (`CMD=ls; $CMD -la`), correct in zsh;
- a use as an argument (`echo $DC`), quoted (`"$DC" ps`) or split (`${=DC}`);
- an array (`DC=(docker compose)`), or a value from `$(…)` or unquoted, whose
  word count the source does not show;
- a value whose only whitespace is inside an expansion (`"$HOME/bin"`);
- a use before the assignment, which reads a value from another call, and a
  use after a later reassignment (`DC=ls`, `DC=(docker compose)`);
- arithmetic, `(( $N ))`;
- text zsh does not run here: single quotes (`sh -c '…'`), heredoc bodies.

Not read: a command taking a command as an argument after options of its own
(`xargs -0 $DC`, `timeout 5 $DC`, `watch -n1 $DC`), where the position depends
on the command's syntax; and a use right after a `case`
branch's `)` or a backtick, since the `)` closing a `$(…)` and a closing
backtick look the same and are followed by arguments. Nor a variable set
outside the command, such as an `EDITOR="codium --wait"` exported into the
session: a `PreToolUse` hook sees one command (ADR-0005).

No exemption for a value that looks like a path with spaces
(`"/Applications/Visual Studio Code.app/…/code"`): `"/usr/bin/env python3"`
looks the same and is two words. The opt-outs cover the deliberate case.

## Measured

`scripts/replay-wordsplit-guard.js --hook command.js` over the commands of
this machine's transcripts holding a quoted assignment with whitespace: 3141
unique commands, 22 hits, all the trap itself — `K="kubectl --context
…"; $K exec …`, `R="scripts/odoo-on prod ./odoo-pp-cli …"; $R …`,
`C="git -C ../cli show origin/main"; $C:docs/…`, `AB="timeout 90
agent-browser"; $AB open …`. Each runs as one command name under the Bash
tool's zsh. Like ADR-0027's, the count is a snapshot of local history.

## Consequences

- The deny names three rewrites: a function, an array and `${=NAME}`. The
  function and the array copy the value unquoted, so they are shown only when
  the value is plain text; a value holding `<`, `|`, a glob, a quote or a word
  starting with `=` or `~` gets `…` in its place, since copying it would turn
  bash's literal words into syntax. The function is named `run_<name>`:
  `GIT="git -C x"` lowercased to `git() { git … }` would call itself, and
  `EXEC` to `exec()` would replace a builtin for the rest of the shell.
  `${=NAME}` is always right, `$C:path` included.
- The opt-outs are the loop rule's: `[nosplit]` and `ALLOW_ZSH_NOSPLIT=1`. A
  value meant as one word in command position, a path with spaces, is the
  deliberate use they exist for.
- A separate script keeps `guard.js` about loops; a command holding both a loop
  hit and a stored command gets both reasons, one per hook.
