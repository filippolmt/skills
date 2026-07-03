---
name: mode-router
disable-model-invocation: true
description: Administer the per-prompt caveman/ponytail router — show status, force a mode, or turn routing off.
---

# mode-router

A `UserPromptSubmit` hook (`hooks/route.js`) fires on every prompt. In `auto`
mode it makes the model classify the request and invoke exactly one mode skill:
coding task → **`ponytail`** (minimal code), everything else → **`caveman`**
(terse output). The mode applies **on top of** any other skill the turn
dispatches — never instead of it. The hook only routes; the two skills own their
behavior. This skill reads and flips the control file that picks the mode.

## Control file

`$XDG_CONFIG_HOME/mode-router/state.json` (or `~/.config/mode-router/state.json`):

```json
{ "mode": "auto" }
```

`mode` is one of: `auto` (default — model routes per request), `caveman` (force
terse everywhere, regardless of request type), `ponytail` (force minimal-code
everywhere), `off` (inject nothing). Missing or invalid → `auto`.

In `auto`, the hook classifies **slash-command prompts** too, so the mode fires
alongside the dispatched skill (e.g. `/improve-codebase-architecture` → also
`ponytail`). It stays silent only when the slash command **is** a mode skill
(`/caveman`, `/ponytail`) — the user already picked one. A **forced** mode is a
standing choice and applies on every prompt regardless.

## Precedence over hard constraints

The router only *suggests* a mode; a hard constraint in force overrides it — the
required output **language/orthography**, or an explicit "be thorough / don't be
brief" instruction for the turn. This bites `caveman` most (its compression
clashes with a strict-language or be-verbose rule). On conflict the model applies
the mode only where compatible, else skips it, and notes the deviation in one
line — for **forced** modes too, since the hook can't detect the constraint.

## Spec-driven workflows

Auto classifies the **launching** prompt of a multi-turn spec-driven workflow
(openspec, bmad, …), but a single slash command spans later turns with no
`UserPromptSubmit` to re-route — so the phase can't switch mid-workflow. For
per-phase control, force the mode first — `ponytail` for the coding phase,
`caveman` for analysis — then reset to `auto`. For direct prompts, the natural
`/clear` between analysis and coding already re-classifies each phase.

## Operations

1. **Status** — read the control file (report `auto` if absent) and state the
   active mode plus the routing rule above. Done when the user knows which mode
   is in force.
2. **Set mode** — write `{ "mode": "<value>" }` to the control file, creating the
   directory if needed. Reject any value outside the four above. Done when the
   file holds the requested value.

Changes take effect on the **next prompt** — the hook re-reads the file every
turn. Nothing is retroactive to the current turn.
