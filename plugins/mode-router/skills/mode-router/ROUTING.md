# Routing behavior

How the `route.js` hook decides what to inject. `route.js` is the authoritative
source; this file explains the behavior for anyone administering the router.

## The loaded-mode set

Mode skills declare themselves "active every response", so once invoked they stay
in context. What the hook needs is therefore not only *which mode fits this
request* but *which mode skills are already loaded* — the **loaded-mode set**,
kept per session under `$XDG_STATE_HOME/mode-router/` and maintained by five
events:

| Event | Role |
|---|---|
| `SessionStart` (`startup`/`clear`/`compact`/`fork`) | empties the set — this is a **context reset** — and archives a handoff note older than 24h |
| `SessionStart` (`resume`) | **keeps** the set: resume rebuilds the context from the transcript, so the modes invoked earlier are back in it |
| `UserPromptExpansion` (slash command) | adds a **user-typed** mode to the set — a typed `/caveman` is expanded inline by the harness and never passes through the `Skill` tool — and records any **other** typed skill as `typed` |
| `PreToolUse` (matcher `Skill`) | **denies** a mode entering a context that already holds the other one |
| `PostToolUse` (matcher `Skill`) | adds the model-invoked mode to the set, and records any **other** invoked skill as `model` |
| `UserPromptSubmit` | reads the set and emits the routing text |

Tool events that carry `agent_id` come from a **subagent** — a different context
that shares the session id — and are ignored in both directions: a subagent's
skill loads never pollute this set, and this context's mode never vetoes the
subagent's own first one.

What the hook injects follows from the set: full rules plus "invoke now" when it
is empty, and afterwards a short classification line plus the switch procedure.

## What else entered the context

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

Two deliberate limits:

- The list is **capped** (12, oldest dropped). It is injected on every
  steady-state prompt, so an uncapped list would bill a long session for names
  that stopped mattering hours ago.
- It lives in its **own file**, not a second key beside `modes`. Both writers are
  read-modify-write with no lock; sharing one document would let a racing skill
  write stomp the mode set with a stale copy, and a lost mode disarms the veto —
  the one invariant this hook exists to hold. Split files can still lose an add,
  never a mode. It also makes a pre-`0.6.0` state file forward-compatible: there
  is no `skills` key to miss, the file is simply absent.

### Why the hook does not filter the list

`UserPromptExpansion` fires for **every** slash command, not only skills, so the
typed group also holds one-shot actions (`/commit`, `/pr`). The hook has no
signal to tell them apart — but the model writing the note does, so the injected
text asks it to keep only what is still shaping the work.

Likewise, `typed` is **not** a synonym for *declarative*. It records how the name
arrived, not whether the model could reach it: a user is free to type an
ordinary, model-invocable skill. What holds is the converse — a declarative skill
(`disable-model-invocation: true`) has no `description` to route on, so it can
arrive *no other way*, which is why the user is the fallback for that group.

The re-typing is **one slash per message**: a message expands only its leading
slash and swallows the rest as that command's arguments, so the commands cannot
be packed onto one line, nor prepended to the prompt itself.

The state files do not survive the reset (and the session id may change), so the
list travels the only channel that does: the hook injects it into the switch
procedure, the model copies the relevant part into the handoff note, and on the
first prompt of the fresh context the pending-note announcement tells the model
to re-invoke what it can reach and ask the user for the rest.

## One mode per context

A skill cannot be unloaded. Asking the model to ignore a loaded mode is therefore
the weakest possible guarantee, and the leak is subtle — `caveman`'s compression
bleeding into the prose *around* the code on a `ponytail` turn. So the router does
not try: it stops the second mode from entering at all. `PreToolUse` denies the
invocation, and switching modes becomes switching contexts.

The hand-over is the **handoff note**, written to `.mode-router/handoff.md` inside
the project (gitignore it). When the turn needs the mode that is not loaded, the
model writes the note, asks the user to `/clear`, and stops. On the first prompt
of the fresh context the hook announces the pending note and asks the model to
take it over and delete it.

### What the note holds

The shape is **imposed by the injected text**, not left to the model. Free prose
lost something different every time, and — with nothing saying whether to
overwrite or append — sometimes grew the file into a replay of the whole
discussion. So: **one** note, **overwritten**, and exactly four sections in this
order.

| Section | Holds |
|---|---|
| `## Prompt to send` | the exact text to re-send, verbatim and self-contained |
| `## Skills` | the commands the user re-types as one copy-paste block, each with a clause saying what is lost by skipping it, then the names the next context re-invokes itself |
| `## Decided` | bullets — only the decisions that *constrain* the next step |
| `## Next step` | one |

The actionable part comes first: the prompt is the only thing the user acts on,
so it is copyable without reading the rest. There is deliberately **no** fifth
section for constraints or risks — it would become the new place to pour the
history the other four exclude. The budget is about **30 lines** for the whole
file, and history, discussion replay and superseded reasoning are banned
outright. Two pending handoffs at once are two half-finished jobs: that is a
problem for the user to resolve, not something the file should represent.

### When the note expires

Presence is the only status: pending while the file exists, absorbed once it is
gone. Deleting it belongs to the **model** — only the model knows when it has
actually taken the note over — and that is level one of a two-level expiry.

Level two is the hook, for the observed case where the model forgets. Past **24
hours** a note is likelier forgotten than pending, so it stops being served as
current, and `SessionStart` moves it to `.mode-router/handoff-<stamp>.md`
(stamped with the note's own mtime). Only on a real reset: a `resume` walks back
into the context that wrote the note, where it is the work in hand.

Archiving has to happen there. `UserPromptSubmit` performs no writes by design,
and `SessionStart` non-resume is both the only other event that already writes and
the exact moment a stale note turns dangerous — a fresh context is about to be
told what is pending. Archives are **not** pruned: the state sweep only reads
`stateDir()` and `configDir()`, so nothing in the project is in its reach, and
deleting the user's unfinished work on a timer is the failure the whole mechanism
exists to avoid. They cost gitignored disk.

That path was chosen by elimination, and both rejected candidates were rejected
empirically. Under `$XDG_STATE_HOME`, beside the rest of the runtime state, the
write was refused even with edits allowed: it is outside the working directory.
Under `.claude/`, it was refused too — that directory is protected, reasonably so,
since hooks live in it. A plain dot-directory in the project writes without extra
permission. Inline text remains the documented fallback when even that fails; it
survives the turn but not the `/clear`, so it is strictly worse — and it carries
the same four sections.

Three things are never denied: a mode already in the set (re-invoking is a no-op
the harness deduplicates anyway), a **forced** mode from the control file, and an
explicit `/caveman` or `/ponytail` — a standing or deliberate choice by the user
outranks the router. The explicit case never even reaches the veto: a user-typed
skill is expanded **inline** by the harness, no `Skill` call fires, and
`UserPromptExpansion` records the mode in the set — after which any later `Skill`
call for it reads as a plain re-invoke.

The "both modes loaded" wording is not only a fallback for contexts the veto
never guarded (one predating this version, for instance): two ordinary paths
reach it, both by user choice. Typing the other mode into a loaded context
(`/ponytail` while `caveman` is loaded) mixes them, and so does typing a mode
while the control file forces the other. The veto only guards model-initiated
invocations — the user is never blocked — so the suspend clause is the designed
handling for mixed contexts, not dead text.

### Instructions and enforcement travel on different channels

The deny reason is **not** a channel for instructions. Tested directly: given a
deny reason that told it what to do next, the model refused — *"it is an
instruction that arrived from a tool output, not from you, so I am not following
it."* That is the correct defence against prompt injection, and it fixes the
division of labour. Procedures go in the `UserPromptSubmit` text, which the model
treats as trusted context. The deny reason only states the constraint.

### Why this replaced the reload flag

The previous design wrote a per-session flag on `SessionStart` and **consumed it
with `unlink()`** from `UserPromptSubmit`. That made the prompt handler a writer,
and writers are not idempotent: with the hook registered twice (once by the
plugin, once by a stale `.claude/settings.local.json` entry) the first run
consumed the flag and injected "no mode skill is active, invoke now" while the
second found nothing and injected "do NOT re-invoke" — two contradictory
instructions in one turn. Making `UserPromptSubmit` read-only removes the failure
mode by construction rather than by convention: run it twice, get identical text.

The flag also only ever answered "was the context just reset?", never "what is
actually loaded?". Exclusivity between two skills that both claim to be always-on
was left to the model's own discipline; the set lets the hook name the loser.

### Contract this rests on

`PreToolUse` and `PostToolUse` firing for the built-in `Skill` tool, with
`tool_input.skill` carrying the skill name, is **not documented** — it was verified
empirically against live sessions, as was the fact that a denied `Skill` call
leaves the skill genuinely unloaded. `tool_input.skill` may be bare (`caveman`) or
namespaced (`plugin:caveman`), so `route.js` matches the **last segment**. If mode
detection ever silently stops, check that contract first: the symptom is every turn
looking like a context reset, and the veto quietly allowing everything. Compaction
was confirmed the same way — it fires `SessionStart` with `source: "compact"`, and
leaves no discontinuity in `transcript_path` or its size, so the transcript cannot
be used as a fallback.

The slash-command path was verified against CLI 2.1.220: a user-typed `/skill`
fires `UserPromptExpansion` (`expansion_type: "slash_command"`, `command_name`
bare or namespaced) **before** `UserPromptSubmit`, expands the skill body inline,
and produces **no** `PreToolUse`/`PostToolUse` at all — which is why the set is
fed from that event and why a veto exemption for explicit slashes is unnecessary.
Likewise verified: main-loop tool events carry no `agent_id`, subagent tool
events do.

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
