---
name: mode-router
disable-model-invocation: true
description: Administer the per-prompt caveman/ponytail router — show status, force a mode, or turn routing off.
---

# mode-router

A hook (`hooks/route.js`) fires on every prompt. In `auto` mode it makes the
model classify the request and invoke exactly one mode skill — coding task →
**`ponytail`** (minimal code), everything else → **`caveman`** (terse output) —
**on top of** any other skill the turn dispatches, never instead of it. A context
holds **one mode**: the first one in. A request that classifies the other way is a
**mode switch**, and the router answers with a notice recommending a reset instead
of loading the second mode ([`ROUTING.md`](ROUTING.md)).

The hook only routes; the two skills own their behavior. This skill reads and
flips the control file that picks the mode.

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
project rather than under `$XDG_STATE_HOME`: `.mode-router/handoff.md`
(gitignore it), plus the `handoff-<stamp>.md` archives the hook moves aside,
which accumulate as gitignored disk because the state sweep never reaches the
project. The user asks for one by typing `/mode-router:carryover` before a
deliberate `/clear`; the router only announces a pending note to the fresh
context. It is also the only channel that survives a reset, so the skill list is
written into it rather than left in the state files. Its shape, its deletion and
its expiry are in [`HANDOFF-NOTE.md`](HANDOFF-NOTE.md).

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

- [`ROUTING.md`](ROUTING.md) — the loaded-mode set and the events that maintain
  it, the switch notice and the veto, per-turn suspension in a mixed context,
  slash commands, precedence over hard constraints, spec-driven workflows, and
  the undocumented harness contracts to check first when routing goes quiet.
- [`HANDOFF-NOTE.md`](HANDOFF-NOTE.md) — the note: whose turn writes it, what it
  holds, what fills its `## Skills` section, and its two-level expiry.
