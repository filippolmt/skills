---
status: accepted
---

# The handoff note is written by a typed `/handoff`, not by injected text

The handoff note's schema used to be injected into every steady-state turn, as
part of the instruction teaching the model to switch contexts when the veto would
block a mode. With the veto gone (`0001-drop-the-skill-veto.md`) nothing asks for
that note any more, but the `/clear` between planning and implementation is still
something users want — so in `0.8.0` the note becomes a **command the user types**,
`/handoff`, and the router keeps only the *read* side: announcing a pending note to
a fresh context.

## Why a typed command, and split in two

The obvious home for the schema is the `mode-router` skill, and it cannot be: that
skill is `disable-model-invocation: true`, so the model cannot reach it. A typed
slash command can — `UserPromptExpansion` expands it inline — and it is the same
channel the design already depends on for re-typing skills after a reset.

The command cannot carry the whole thing, though. The note's `## Skills` section
needs the list of what entered this context, which lives in
`session-<id>.skills.json`, and **the model does not know its own session id**: a
command body saying "read the state file" has no filename to read, and picking the
most recent by mtime breaks with two sessions open. The hook does know the id. So:

- **`commands/handoff.md`** carries the static half — the four sections, the
  ~30-line budget, the bans. Static text belongs in a file, not in a string inside
  a hook. (First `commands/` directory of any local plugin in this repo.)
- **The hook** recognises `/handoff` on `UserPromptSubmit`, emits the skill list,
  and says nothing about routing that turn — the same silence it already keeps for
  a typed `/caveman`. The note has an imposed shape and no prose to style; a mode
  there could only argue with the schema.
- **`/handoff` is excluded from the recorded skill list**, by the same filter that
  excludes the modes — otherwise `UserPromptExpansion` files it as a `typed` skill
  and the note ends up citing itself.

## Consequences

- The skill list stops being injected on every steady-state prompt and is emitted
  **once**, on the `/handoff` turn. That is a per-turn saving on top of the one
  measured in `0001`, which did not count it.
- `MAX_SKILLS` (12) stays, but its stated reason changes: not "it is injected every
  turn" — it no longer is — but the note's ~30-line budget, and the fact that a
  `## Skills` block naming forty names is one nobody re-types.
- Everything decided about the note itself is untouched: one file, overwritten,
  four fixed sections, presence *is* pending status, and the two-level expiry with
  `SessionStart` archiving anything older than 24h. None of it ever named the veto;
  only its *home* changes, from a string in the hook to the command file.
- The user has to type the command for a note to exist. That dependency is accepted
  as permanent — it is the same one already accepted for re-typing skills into the
  fresh context — and it is what makes the `/clear` a deliberate act rather than a
  toll the router collects.

## Settled during implementation

Four things this split forced, none of them visible until the code was written.

- **The resolved path stays with the hook.** The third consequence above claims
  everything about the note is untouched, and one thing is not: `0.7.0` injected
  `handoffFile(cwd)` into the writing turn, so writer and reader could not disagree.
  A static file can carry only a *relative* path, while the read side resolves it
  against `cwd` — a session started outside the project root would write one place
  and be read another, losing the note in silence. So the hook names the absolute
  path on the `/handoff` turn, and does so even when no skill was recorded: the list
  is optional, the path is not.
- **The command is `disable-model-invocation: true`.** Not asked for, and required
  by the mechanism: reached through the `Skill` tool there is no `UserPromptSubmit`,
  so neither the path nor the list is emitted and the note is written blind. The
  last consequence above already accepts that a note exists because the user asked
  for one; this is that sentence enforced rather than hoped for.
- **`/handoff` means *this* plugin's.** `handoff` is a common name — this
  marketplace already carries an unrelated skill by it — so the last-segment rule
  the modes use is wrong here: it would capture `X:handoff` for any `X`, suppress
  routing on a turn this plugin has no part in, and inject a list aimed at a note
  the other skill does not write. Bare stays ours, a namespace has to be
  `mode-router:`.
- **A forced mode gives way on the `/handoff` turn.** The spec said both things:
  `ROUTING.md`'s event table made the exception unconditional, its *Slash commands*
  section said a forced mode "applies on every prompt regardless". The table's side
  wins, on this ADR's own reasoning — the note has an imposed shape and no prose to
  style, so a mode there could only argue with the schema — and the other line was
  amended to name the exception. A forced mode already loaded still applies; it is
  simply not *requested* on that turn. `off` continues to outrank everything.
