---
name: mode-router
disable-model-invocation: true
description: Administer the per-prompt caveman/ponytail router — show status, force a mode, or turn routing off.
---

# mode-router

A hook (`hooks/route.js`) fires on every prompt. In `auto`
mode it makes the model classify the request and invoke exactly one mode skill:
coding task → **`ponytail`** (minimal code), everything else → **`caveman`**
(terse output). The mode applies **on top of** any other skill the turn
dispatches — never instead of it. Exactly one mode applies **per turn**: a second
one entering the context is not refused, it is **suspended** on every turn it is
not the one classified to. Switching mode therefore needs no context reset. The
hook only routes; the two skills own their behavior. This skill reads and flips
the control file that picks the mode.

## Control file

`$XDG_CONFIG_HOME/mode-router/state.json` (or `~/.config/mode-router/state.json`):

```json
{ "mode": "auto" }
```

`mode` is one of: `auto` (default — model routes per request), `caveman` (force
terse everywhere, regardless of request type), `ponytail` (force minimal-code
everywhere), `off` (inject nothing). Missing or invalid → `auto`.

This file is **user configuration** and nothing else writes to it. Runtime state
is kept apart under `$XDG_STATE_HOME/mode-router/` (or
`~/.local/state/mode-router/`), two files per session:

```json
session-<id>.json         { "modes": ["caveman"] }
session-<id>.skills.json  { "skills": [{ "name": "grilling", "source": "typed" }] }
```

The first is the loaded-mode set; the second records everything else that entered
the context, tagged `typed` (a user slash) or `model` (a `Skill` call) — the tag
says who can bring it back after a reset. They are kept apart so a skill write can
never clobber the mode set. Both are disposable — deleting them costs at most one
redundant skill invocation and the skill list in the next handoff — and stale
files are swept on `SessionStart` after 7 days.

A pending **handoff note** is not state but unfinished work, so it lives in the
project at `.mode-router/handoff.md` (gitignore it) — **one** file, overwritten
rather than appended to, four fixed sections, about 30 lines. Its presence *is*
its state: pending while the file is there, absorbed once the model deletes it.
The user asks for one by typing `/handoff` before a deliberate `/clear`; the
router only announces a pending note to the fresh context.

Deleting it is the model's job, since only the model knows when it has taken the
note over; the hook backstops the case where it forgets. Past **24 hours** the
note is no longer served as current, and `SessionStart` (on a real reset, not a
resume) archives it to `.mode-router/handoff-<stamp>.md`. The state sweep never
reaches the project, so neither notes nor archives are ever deleted on age —
archives accumulate as gitignored disk.

The note is also the only channel that survives a reset, so the skill list is
written into it rather than left in the state files.

## Operations

1. **Status** — read the control file (report `auto` if absent) and state the
   active mode plus the `auto` routing rule. Done when the user knows which mode
   is in force.
2. **Set mode** — write `{ "mode": "<value>" }` to the control file, creating the
   directory if needed. Reject any value outside the four above. Done when the
   file holds the requested value.

Changes take effect on the **next prompt** — the hook re-reads the file every turn.

## Routing behavior

`route.js` is the single source of truth for the exact routing and precedence
rules, and injects them into every turn. For how slash commands, precedence over
hard constraints, and multi-turn spec-driven workflows are handled, see
[`ROUTING.md`](ROUTING.md).
