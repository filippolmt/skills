# Routing behavior

How the `route.js` hook decides what to inject. `route.js` is the authoritative
source; this file explains the behavior for anyone administering the router.

One line holds the whole design: **the set decides what to invoke, the suspension
decides who speaks.**

## The loaded-mode set

Mode skills declare themselves "active every response", so once invoked they stay
in context. What the hook needs is therefore not only *which mode fits this
request* but *which mode skills are already loaded* — the **loaded-mode set**,
kept per session under `$XDG_STATE_HOME/mode-router/` and maintained by four
events:

| Event | Role |
|---|---|
| `SessionStart` (`startup`/`clear`/`compact`/`fork`) | empties the set — this is a **context reset** — and archives a handoff note older than 24h |
| `SessionStart` (`resume`) | **keeps** the set: resume rebuilds the context from the transcript, so the modes invoked earlier are back in it |
| `UserPromptExpansion` (slash command) | adds a **user-typed** mode to the set — a typed `/caveman` is expanded inline by the harness and never passes through the `Skill` tool — and records any **other** typed skill as `typed` |
| `PostToolUse` (matcher `Skill`) | adds the model-invoked mode to the set, and records any **other** invoked skill as `model` |
| `UserPromptSubmit` | reads the set and emits the routing text — except on a `/carryover` prompt, where it emits the note's resolved path plus the skill list, and says nothing about routing |

Tool events that carry `agent_id` come from a **subagent** — a different context
that shares the session id — and are ignored: a subagent's skill loads never
pollute this set.

What the hook injects follows from the set, in two branches:

- **Empty set** — the full rules plus "invoke now", and the announcement of a
  pending handoff note if one is waiting.
- **Non-empty set** — the short classification line, a *conditional* invocation
  ("invoke the one that is missing if you classify to it; do not re-invoke the one
  already here"), and the suspension clause aimed at the other mode.

There is no third branch. Whether one mode is loaded or both, the state the model
answers in is the same — every body in the context is in it — so the same text
governs both, and the only thing that varies is whether an invocation is still
being asked for.

### What else entered the context

The same two events record every **non-mode** name they carry, in a second
per-session file, `session-<id>.skills.json`:

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
plugin's — see **Whose turn it is** below; anything else, `handoff` included, is an
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

## One mode per turn

A skill cannot be unloaded. Exclusivity therefore cannot mean *one mode per
context* — nothing can take the second body back out once it is in — so it means
**one mode per turn**: the turn's text applies the mode the request classifies to
and declares the other one suspended, contributing nothing, not even to the prose.

Until `0.8.0` the router tried the stronger reading and stopped the second mode
from entering at all: `PreToolUse` denied the invocation, and switching modes
meant switching contexts. The leak that veto existed to prevent — `caveman`'s
compression bleeding into the prose *around* the code on a `ponytail` turn — was
then measured, and does not happen; neither does the opposite one. The veto was
paying for a leak that is not there, so it was removed. The measurements and the
reasoning are in `docs/adr/0001-drop-the-skill-veto.md`, at the root of the
marketplace repo.

A context holding both mode skills is therefore a **mixed context**, and it is the
normal steady state of any long session rather than a fallback: the second mode
enters the first time a turn classifies the other way, and stays. Two ordinary
paths reach it besides — typing the other mode (`/ponytail` while `caveman` is
loaded), and typing a mode while the control file forces the other.

Three things follow, and they are the whole of the rule:

- **The set never blocks anything.** It decides only between *invoke* and *do not
  re-invoke*. A mode already loaded is never invoked again; the missing one is
  invoked the turn it is classified to.
- **The suspension is per turn, and only words.** The suspended mode is still
  loaded, just inert for that turn, and the clause denies it *any* influence
  rather than merely asking for one mode: the leak it guards is subtle enough that
  "apply one, not the other" leaves room for it. Wording in this branch has
  measurable and counter-intuitive effects, so it is not rephrased casually.
- **A coding turn is pure `ponytail`.** The one directional clause the router
  carries (`CODING_IS_PURE`) says the explanations and notes around the code read
  as normal writing, not as `caveman`. It exists because that leak was reported in
  use. There is deliberately **no** mirror clause for the other direction: the
  stub it would prevent was measured and does not occur, and the obvious wording
  for it diluted `caveman` instead of defending it (again, ADR-0001).

### Contract this rests on

`PostToolUse` firing for the built-in `Skill` tool, with `tool_input.skill`
carrying the skill name, is **not documented** — it was verified empirically
against live sessions. `tool_input.skill` may be bare (`caveman`) or namespaced
(`plugin:caveman`), so `route.js` matches the **last segment**. If mode detection
ever silently stops, check that contract first: the symptom is every turn looking
like a context reset, so every turn asking for an invocation the context already
has. Compaction was confirmed the same way — it fires `SessionStart` with
`source: "compact"`, and leaves no discontinuity in `transcript_path` or its size,
so the transcript cannot be used as a fallback.

The slash-command path was verified against CLI 2.1.220 and re-confirmed on
2.1.237: a user-typed `/skill` fires `UserPromptExpansion` (`expansion_type:
"slash_command"`, `command_name` bare or namespaced) **before** `UserPromptSubmit`,
expands the skill body inline, and produces **no** `PreToolUse`/`PostToolUse` at
all — which is why the set is fed from that event. Likewise verified: main-loop
tool events carry no `agent_id`, subagent tool events do, and a loaded skill
cannot be unloaded by any mechanism the harness offers.

### Why `UserPromptSubmit` writes nothing

The design that preceded the set wrote a per-session flag on `SessionStart` and
**consumed it with `unlink()`** from `UserPromptSubmit`. That made the prompt
handler a writer, and writers are not idempotent: with the hook registered twice
(once by the plugin, once by a stale `.claude/settings.local.json` entry) the
first run consumed the flag and injected "no mode skill is active, invoke now"
while the second found nothing and injected "do NOT re-invoke" — two contradictory
instructions in one turn. Making `UserPromptSubmit` read-only removes the failure
mode by construction rather than by convention: run it twice, get identical text.

It is also why the note's 24h expiry is split in two. This branch only *stops
serving* a stale note; moving it aside is `SessionStart`'s job, that being the
only other event which already writes.

The flag also only ever answered "was the context just reset?", never "what is
actually loaded?" — and the second question is the one every turn's text now
depends on.

## The handoff note

Switching mode no longer requires a context reset, so the router no longer asks
for one. The `/clear` between planning and implementation survives as something
the **user** wants — the point of it is a fresh context, not a mode change — and
the note that carries work across it is written on demand by the **`/carryover`
command** (`commands/carryover.md`), never by injected text.

The split between command and hook follows from one fact: the model does not know
its own session id, so it cannot find `session-<id>.skills.json` by name. So the
command body carries the static half — the schema below — and the hook, which does
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

### Whose turn it is

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

### What the note holds

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

### When the note expires

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

## Slash commands

In `auto`, the hook classifies **slash-command prompts** too, so the mode fires
alongside the dispatched skill (e.g. `/improve-codebase-architecture` → also
`ponytail`). It stays silent only when the slash command **is** a mode skill
(`/caveman`, `/ponytail`) — the user already picked one — or this plugin's
`/carryover`, which gets the note's path and the skill list instead. A **forced**
mode is a standing choice and applies on every prompt regardless — with the same
one exception: on a `/carryover` turn the hook asks for no invocation, because that
turn produces a file of imposed shape and no prose to style. A forced mode already
loaded still applies to it; it is just not requested there. `off` outranks
everything, `/carryover` included: it means inject nothing.

## Precedence over hard constraints

The router only *suggests* a mode. A mode compresses/simplifies **style only** —
it never changes the output language or drops required orthography (`caveman`
preserves the user's language and its accents), so a language/orthography rule is
not a conflict; only an explicit "be thorough / don't be brief" instruction or a
hard rule banning compression itself overrides the mode. The hook injects the
exact rule (`PRECEDENCE` in `route.js`) whenever it asks for an invocation — at
every context reset, and on every prompt in a forced mode until that mode is
loaded. It is not repeated afterwards: the text is still in the transcript above,
and re-injecting it costs ~330 tokens a turn. On conflict the model applies
the mode only where compatible, else skips it and notes the deviation in one
line — for **forced** modes too, since the hook can't detect the constraint.

## Spec-driven workflows

Auto classifies the **launching** prompt of a multi-turn spec-driven workflow
(openspec, bmad, …), but a single slash command spans later turns with no
`UserPromptSubmit` to re-route — so the phase can't switch mid-workflow. For
per-phase control, force the mode first — `ponytail` for the coding phase,
`caveman` for analysis — then reset to `auto`. For direct prompts, the natural
`/clear` between analysis and coding already re-classifies each phase.
