# Routing behavior

How the `route.js` hook decides what to inject. `route.js` is the authoritative
source; this file explains the behavior for anyone administering the router.

## Slash commands

In `auto`, the hook classifies **slash-command prompts** too, so the mode fires
alongside the dispatched skill (e.g. `/improve-codebase-architecture` → also
`ponytail`). It stays silent only when the slash command **is** a mode skill
(`/caveman`, `/ponytail`) — the user already picked one. A **forced** mode is a
standing choice and applies on every prompt regardless.

## Precedence over hard constraints

The router only *suggests* a mode. A mode compresses/simplifies **style only** —
it never changes the output language or drops required orthography (`caveman`
preserves the user's language and its accents), so a language/orthography rule is
not a conflict; only an explicit "be thorough / don't be brief" instruction or a
hard rule banning compression itself overrides the mode. The hook injects the
exact rule every turn (`PRECEDENCE` in `route.js`); on conflict the model applies
the mode only where compatible, else skips it and notes the deviation in one
line — for **forced** modes too, since the hook can't detect the constraint.

## Spec-driven workflows

Auto classifies the **launching** prompt of a multi-turn spec-driven workflow
(openspec, bmad, …), but a single slash command spans later turns with no
`UserPromptSubmit` to re-route — so the phase can't switch mid-workflow. For
per-phase control, force the mode first — `ponytail` for the coding phase,
`caveman` for analysis — then reset to `auto`. For direct prompts, the natural
`/clear` between analysis and coding already re-classifies each phase.
