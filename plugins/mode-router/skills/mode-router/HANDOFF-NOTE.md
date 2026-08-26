# The handoff note

What a context leaves behind for the one that replaces it, and the machinery
around it: whose turn writes it, what it holds, what fills its `## Skills`
section, and when it stops counting as pending.

The routing half — the loaded-mode set, per-turn suspension, the harness contracts
the design rests on — is in [`ROUTING.md`](ROUTING.md). `route.js` is the
authoritative source for both.

On a mode switch the router **recommends** a context reset and never demands one
(ROUTING.md, "One mode per context"). The `/clear` is the **user's** — they can
decline it and go on with no mode — and the note that carries work across it is
written on demand by the **`/carryover` command** (`commands/carryover.md`), never
by injected text.

The split between command and hook follows from one fact: the model does not know
its own session id, so it cannot find `session-<id>.skills.json` by name. So the
command body carries the static half — the four sections — and the hook, which does
know the session id, emits the skill list on that turn and stays silent about
routing. The note has an imposed shape and no prose to style; a mode there could
only argue with the schema. That silence covers a **forced** mode too: the hook
asks for no invocation on this turn. A forced mode already in the context still
applies — a loaded skill cannot be told to stop — it simply is not requested here.

The **resolved path** travels the same channel, for the same kind of reason. A file
can only carry a relative path, and the read side resolves `.mode-router/handoff.md`
against `cwd`; a session started outside the project root would then write one
place and be read another, losing the note in silence. So the hook names the
absolute path on the `/carryover` turn — and it is emitted even when nothing was
recorded, since it is the half that cannot be allowed to drift.

## Whose turn it is

The command is `/mode-router:carryover` — namespaced, that being the only form the
harness exposes. Through `0.8.0` it was `/handoff`, a name another
plugin in this marketplace also answers to, which made the hook claim turns that
expanded somebody else's body. `docs/adr/0004-rename-the-handoff-command.md` carries
the measurements — of the old name and of the new one — and the rejected
alternative; they are not restated here.

The match is the **full namespaced name and nothing else**: `/mode-router:carryover`.
Not the last-segment rule the modes use, which would capture any `X:carryover` and
suppress routing on a turn this plugin has no part in; and not the bare
`/carryover`, which no path can deliver — the harness exposes plugin commands
namespaced only, so a bare one typed anyway dies as `Unknown command` before this
hook runs. `/mode-router:carryover` is therefore not merely the canonical form to
type, it is the only one that works.

The note goes to `.mode-router/handoff.md` inside the project (gitignore it). The
router keeps only the **read** side: on the first prompt of a fresh context, the
empty-set branch announces the pending note and asks the model to take it over and
delete it.

It announces only a note **somebody else** left. A context is not told to take over
and delete the note it just wrote itself — which is what an empty mode set used to
mean here, and does not: a session where no mode has loaded yet has one too, and
the turn that writes the note is exactly such a turn, because the hook invokes no
mode there. So typing the command drops a marker (`session-<id>.wrote-note`, next to
the rest of the session state) and the announcement skips a note **newer than that
marker's mtime**. A reset clears the marker along with everything else per-session,
which is where "somebody else" comes from; a `resume` keeps it, being the same
context walking back in.

The mtime is what makes the marker qualify the *note* rather than the whole
session. A note already waiting when the command was typed is older than the
marker, so it stays somebody else's and is still handed over — otherwise one
`/carryover` would blind a session to every note in the project, and typing the
command and then writing nothing would blind it to all of them. The marker is
written once per session for the same reason: a second write would move its mtime
past a note already written here and hand that note back to its own author.

### The limit: notes are project-scoped, sessions are not

The marker keys on the session id, so it answers "did *this session* write it",
which is narrower than "is its author still working". Two consequences, both
predating this gate and neither closed by it:

- A **second session** in the same project has no marker, so it is told to take
  over and delete a note the first session is still using.
- A **fork** is a new session id, so the same applies — even though the forked
  context is a continuation rather than somebody else.

Closing these needs a liveness signal the hook does not have; the plausible
substitutes trade one silent failure for another, so the mismatch is recorded here
rather than patched. Two contexts working one project on one pending note is the
same "two half-finished jobs" the note's one-file rule already refuses to
represent.

## What the note holds

The shape is **imposed by the command**, not left to the model. Free prose lost
something different every time, and — with nothing saying whether to overwrite or
append — sometimes grew the file into a replay of the whole discussion. So: **one**
note, **overwritten**, four fixed sections, about **30 lines**.

The sections themselves are named in `commands/carryover.md`, which is where the
model reads them; naming them here too would be one schema maintained in two
places, drifting apart on the first edit. What belongs here is why the shape is
closed. The actionable part comes first: the prompt is the only thing the user acts
on, so it is copyable without reading the rest. And there is deliberately **no**
fifth section for constraints or risks — it would become the new place to pour the
history the other four leave out. Two pending handoffs at once are two half-finished
jobs: a problem for the user to resolve, not something the file should represent.

## What fills the note's `## Skills`

The two events that feed the loaded-mode set — `UserPromptExpansion` and
`PostToolUse` on `Skill`, both described in [`ROUTING.md`](ROUTING.md) — also
record every **non-mode** name they carry, in a second per-session file,
`session-<id>.skills.json`:

```json
{ "skills": [{ "name": "grilling", "source": "typed" }] }
```

`source` is `typed` (a user slash, seen through `UserPromptExpansion`) or `model`
(a `Skill` call). Names are stored as they arrived, bare or namespaced — that is
the form to re-type or re-invoke — but deduplicated on the **last segment**, so a
typed `/grilling` and an invoked `grilling:grilling` are one entry rather than the
same skill filed under two contradictory sources. First arrival keeps the tag.
This plugin's `/carryover` is excluded, exactly as the modes are: it is the command
that *writes* the note, and recording it would make the note cite itself. Only this
plugin's — see **Whose turn it is** above; anything else, `handoff` included, is an
ordinary skill and is recorded like any other.

The list is emitted **once**, on the turn that command is typed — not on every
prompt. Two deliberate limits survive that:

- The list is **capped** (12, oldest dropped). The note it feeds has a ~30-line
  budget, and a `## Skills` section naming forty names is one nobody re-types. In
  a long session the earliest skills are also the least likely to still be shaping
  the work being handed off.
- It lives in its **own file**, not a second key beside `modes`. Both writers are
  read-modify-write with no lock; sharing one document would let a racing skill
  write stomp the mode set with a stale copy. A lost mode is no longer a broken
  invariant — it costs one redundant invocation of a mode already in the context,
  which the harness deduplicates anyway — but the set is what every turn's text is
  computed from, so it is the half worth protecting. Split files can still lose an
  add, never a mode. It also makes a pre-`0.6.0` state file forward-compatible:
  there is no `skills` key to miss, the file is simply absent.

### Why the hook does not filter the list

`UserPromptExpansion` fires for **every** slash command, not only skills, so the
typed group also holds one-shot actions (`/commit`, `/pr`). The hook has no
signal to tell them apart — but the model writing the note does, so the **command**
asks it to keep only what is still shaping the work. What the hook emits is data:
the names and how each arrived. What to do with them is static text, and lives in
`commands/carryover.md` rather than in a string inside the hook, so that one
instruction is maintained in one place.

Likewise, `typed` is **not** a synonym for *declarative*. It records how the name
arrived, not whether the model could reach it: a user is free to type an
ordinary, model-invocable skill. What holds is the converse — a declarative skill
(`disable-model-invocation: true`) has no `description` to route on, so it can
arrive *no other way*, which is why the user is the fallback for that group.

The re-typing is **one slash per message**: a message expands only its leading
slash and swallows the rest as that command's arguments, so the commands cannot
be packed onto one line, nor prepended to the prompt itself. That rule is stated
where it is acted on, in the command file.

The state files do not survive the reset (and the session id may change), so the
list travels the only channel that does: `/carryover` injects it into the note the
model writes, and on the first prompt of the fresh context the pending-note
announcement tells the model to re-invoke what it can reach and ask the user for
the rest.

## When the note expires

Presence is the only status: pending while the file exists, absorbed once it is
gone. Deleting it belongs to the **model** — only the model knows when it has
actually taken the note over — and that is level one of a two-level expiry.

Level two is the hook, for the observed case where the model forgets. Past **24
hours** a note is likelier forgotten than pending, so it stops being served as
current, and `SessionStart` moves it to `.mode-router/handoff-<stamp>.md`
(stamped with the note's own mtime). Only on a real reset: a `resume` walks back
into the context that wrote the note, where it is the work in hand.

Archives are **not** pruned: the state sweep only reads `stateDir()` and
`configDir()`, so nothing in the project is in its reach, and deleting the user's
unfinished work on a timer is the failure the whole mechanism exists to avoid.
They cost gitignored disk.

That path was chosen by elimination, and both rejected candidates were rejected
empirically. Under `$XDG_STATE_HOME`, beside the rest of the runtime state, the
write was refused even with edits allowed: it is outside the working directory.
Under `.claude/`, it was refused too — that directory is protected, reasonably so,
since hooks live in it. A plain dot-directory in the project writes without extra
permission. Inline text remains the documented fallback when even that fails; it
survives the turn but not the `/clear`, so it is strictly worse — and it carries
the same four sections.
