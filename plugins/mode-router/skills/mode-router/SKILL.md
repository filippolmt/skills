---
name: mode-router
disable-model-invocation: true
description: Administer the per-prompt caveman/ponytail router — show status, force a mode, or turn routing off. Type /mode-router:mode-router.
---

# mode-router

A `UserPromptSubmit` hook (`hooks/route.js`) fires on every prompt and makes the
model apply **exactly one** mode per request:

- **coding task** (writing/editing/refactoring/debugging code, tests, picking a
  dependency) → **ponytail** (minimal code)
- **anything else** (explaining, answering, planning, docs) → **caveman** (terse output)

The rulesets live in `hooks/route.js` — the single source of truth. This skill
only reads and flips the control file; it never restates the rules.

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
