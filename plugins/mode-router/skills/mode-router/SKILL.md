---
name: mode-router
disable-model-invocation: true
description: Administer the per-prompt caveman/ponytail router — show status, force a mode, or turn routing off. Type /mode-router:mode-router.
---

# mode-router

A `UserPromptSubmit` hook (`hooks/route.js`) fires on every prompt and makes the
model **invoke exactly one skill** per request:

- **coding task** (writing/editing/refactoring/debugging code, tests, picking a
  dependency) → invoke the **`ponytail`** skill (minimal code)
- **anything else** (explaining, answering, planning, docs) → invoke the
  **`caveman`** skill (terse output)

The hook only routes — it carries no ruleset. The `caveman` and `ponytail`
skills are the single source of truth for their own behavior; the hook names
which one the model must invoke. **Both skills must be installed and enabled**
for routing to land. This skill only reads and flips the control file.

## Control file

`$XDG_CONFIG_HOME/mode-router/state.json` (or `~/.config/mode-router/state.json`):

```json
{ "mode": "auto" }
```

`mode` is one of: `auto` (default — model routes per request), `caveman` (force
terse everywhere), `ponytail` (force minimal-code everywhere), `off` (inject
nothing). Missing or invalid → `auto`.

## Operations

1. **Status** — read the control file (report `auto` if absent) and state the
   active mode plus the routing rule above. Done when the user knows which mode
   is in force.
2. **Set mode** — write `{ "mode": "<value>" }` to the control file, creating the
   directory if needed. Reject any value outside the four above. Done when the
   file holds the requested value.

Changes take effect on the **next prompt** — the hook re-reads the file every turn.
Nothing is retroactive to the current turn.
