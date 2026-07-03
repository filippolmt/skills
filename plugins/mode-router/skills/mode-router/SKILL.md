---
name: mode-router
disable-model-invocation: true
description: Administer the per-prompt caveman/ponytail router — show status, force a mode, or turn routing off. Type /mode-router:mode-router.
---

# mode-router

A `UserPromptSubmit` hook (`hooks/route.js`) fires on every prompt. In `auto`
mode it makes the model classify the request and invoke exactly one skill:
coding task → **`ponytail`** (minimal code), everything else → **`caveman`**
(terse output). The hook only routes; the two skills own their behavior. This
skill reads and flips the control file that picks the mode.

## Control file

`$XDG_CONFIG_HOME/mode-router/state.json` (or `~/.config/mode-router/state.json`):

```json
{ "mode": "auto" }
```

`mode` is one of: `auto` (default — model routes per request), `caveman` (force
terse everywhere, regardless of request type), `ponytail` (force minimal-code
everywhere), `off` (inject nothing). Missing or invalid → `auto`.

The hook stays silent on **slash-command prompts** (the user already dispatched
to a skill), so an explicit `/skill` invocation is never overridden.

## Operations

1. **Status** — read the control file (report `auto` if absent) and state the
   active mode plus the routing rule above. Done when the user knows which mode
   is in force.
2. **Set mode** — write `{ "mode": "<value>" }` to the control file, creating the
   directory if needed. Reject any value outside the four above. Done when the
   file holds the requested value.

Changes take effect on the **next prompt** — the hook re-reads the file every
turn. Nothing is retroactive to the current turn.
