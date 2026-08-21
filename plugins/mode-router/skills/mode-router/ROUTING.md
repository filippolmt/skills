# Routing behavior

How the `route.js` hook decides what to inject. `route.js` is the authoritative
source; this file explains the behavior for anyone administering the router.

One line holds the whole design: **the set decides what to invoke, the suspension
decides who speaks.**

The handoff note is the router's other half and has its own file,
[`HANDOFF-NOTE.md`](HANDOFF-NOTE.md): whose turn writes it, what it holds, what
fills its `## Skills`, and when it expires. Nothing about it is repeated here —
what appears below is only where a routing event touches it.

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
  pending handoff note if one is waiting ([`HANDOFF-NOTE.md`](HANDOFF-NOTE.md)).
- **Non-empty set** — the short classification line, a *conditional* invocation
  ("invoke the one that is missing if you classify to it; do not re-invoke the one
  already here"), and the suspension clause aimed at the other mode.

There is no third branch. Whether one mode is loaded or both, the state the model
answers in is the same — every body in the context is in it — so the same text
governs both, and the only thing that varies is whether an invocation is still
being asked for.

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
