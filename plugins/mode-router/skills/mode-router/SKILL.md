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
dispatches — never instead of it. A context holds **one mode**: the first one in.
A request that classifies the other way is a **mode switch** — the router does
not load the other mode; it answers with a one-line notice recommending
`/mode-router:carryover` then `/clear`, and the user either does that or replies
"proceed" to get the request answered with no mode at all. A `PreToolUse` veto
backs the notice up. Only a user-typed `/caveman` or `/ponytail` can put both
modes in one context; from then on the one not classified to is **suspended**
per turn. The hook only routes; the two skills own their behavior. This skill
reads and flips the control file that picks the mode.

## Control file

`$XDG_CONFIG_HOME/mode-router/state.json` (or `~/.config/mode-router/state.json`):

```json
{ "mode": "auto" }
```

`mode` is one of: `auto` (default — model routes per request), `caveman` (force
terse everywhere, regardless of request type), `ponytail` (force minimal-code
everywhere), `off` (inject nothing). Missing or invalid → `auto`. A forced mode
does not override a context that already holds the other one: it gets the same
switch notice, and takes effect after the `/clear`.

This file is **user configuration** and nothing else writes to it. Runtime state
is kept apart under `$XDG_STATE_HOME/mode-router/` (or
`~/.local/state/mode-router/`), three files per session:

```json
session-<id>.json         { "modes": ["caveman"] }
session-<id>.skills.json  { "skills": [{ "name": "grilling", "source": "typed" }] }
session-<id>.wrote-note   {}  (its mtime is the payload)
```

The first is the loaded-mode set; the second records everything else that entered
the context, tagged `typed` (a user slash) or `model` (a `Skill` call) — the tag
says who can bring it back after a reset. They are kept apart so a skill write can
never clobber the mode set. Those two are disposable — deleting them costs at most
one redundant skill invocation and the skill list in the next handoff.

The third is dropped when `/mode-router:carryover` is typed, and its **mtime** is
what matters: a note newer than it was written here, so the router never hands a
note back to its own author. That one is **not** disposable — deleting it re-opens
exactly that.

Stale files are swept on `SessionStart` after 7 days.

A pending **handoff note** is not state but unfinished work, so it lives in the
project at `.mode-router/handoff.md` (gitignore it) — **one** file, overwritten
rather than appended to, four fixed sections, about 30 lines. Its presence *is*
its state: pending while the file is there, absorbed once the model deletes it.
The user asks for one by typing `/mode-router:carryover` before a deliberate
`/clear` — namespaced, that being the only form the harness exposes. The router
only announces a pending note to the fresh context.

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
rules, and injects them into every turn.

Two files explain that behavior for whoever administers it:

- [`ROUTING.md`](ROUTING.md) — the loaded-mode set and the events that
  maintain it, the switch notice and the veto, per-turn suspension in a mixed
  context, the harness contracts the whole design rests on
  and how to check them when routing goes quiet, slash commands, precedence over
  hard constraints, and multi-turn spec-driven workflows.
- [`HANDOFF-NOTE.md`](HANDOFF-NOTE.md) — the note: whose turn writes it, what it
  holds, what fills its `## Skills` section, and its two-level expiry.
