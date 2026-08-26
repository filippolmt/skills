# Routing behavior

How the `route.js` hook decides what to inject. `route.js` is the authoritative
source; this file explains the behavior for anyone administering the router.

One line holds the whole design: **a context holds one mode — the first one in —
and the router never brings in the second.** A request that classifies the other
way is a **mode switch**: the turn is spent telling the user so, and recommending
a reset.

The handoff note is the router's other half and has its own file,
[`HANDOFF-NOTE.md`](HANDOFF-NOTE.md): whose turn writes it, what it holds, what
fills its `## Skills`, and when it expires. Nothing about it is repeated here —
what appears below is only where a routing event touches it.

## The loaded-mode set

Mode skills declare themselves "active every response", so once invoked they stay
in context. What the hook needs is therefore not only *which mode fits this
request* but *which mode skills are already loaded* — the **loaded-mode set**,
kept per session under `$XDG_STATE_HOME/mode-router/` and maintained by these
events:

| Event | Role |
|---|---|
| `SessionStart` (`startup`/`clear`/`compact`/`fork`) | empties the set — this is a **context reset** — and archives a handoff note older than 24h |
| `SessionStart` (`resume`) | **keeps** the set: resume rebuilds the context from the transcript, so the modes invoked earlier are back in it |
| `UserPromptExpansion` (slash command) | adds a **user-typed** mode to the set — a typed `/caveman` is expanded inline by the harness and never passes through the `Skill` tool — and records any **other** typed skill as `typed`; on `/carryover`, marks this session as the note's author instead |
| `PreToolUse` (matcher `Skill`) | the **mode veto**: denies a mode skill entering a context that already holds the other one, a forced mode included — only `off` switches it off |
| `PostToolUse` (matcher `Skill`) | adds the model-invoked mode to the set, and records any **other** invoked skill as `model` |
| `UserPromptSubmit` | reads the set and emits the routing text — except on a `/carryover` prompt, where it emits the note's resolved path plus the skill list, and says nothing about routing |

Tool events that carry `agent_id` come from a **subagent** — a different context
that shares the session id — and are ignored: a subagent's skill loads never
pollute this set.

What the hook injects follows from the set, in three branches:

- **Empty set** — the full rules plus "invoke now", and the announcement of a
  pending handoff note if one is waiting — unless this session is the one that
  wrote it ([`HANDOFF-NOTE.md`](HANDOFF-NOTE.md)).
- **One mode loaded** — the short classification line, then: if the request
  classifies to the loaded mode, apply it (no re-invoke); if it classifies to the
  other one, this is a **mode switch** — do *not* invoke it, and answer with the
  **switch notice** instead (below).
- **Both loaded** (a **mixed context**) — invoke neither; apply the mode the
  request classifies to and suspend the other one for the turn.

## One mode per context

A skill cannot be unloaded, so the only way to keep a context in one mode is to
never let the second one in. The router does that in two layers:

1. **The switch clause and the switch notice.** On a switch, the routing text
   (the *clause*, what the model receives) tells it not to invoke the other mode
   and to answer with one line only (the *notice*, what the user sees), in the
   user's language:
   *this is a `ponytail` request in a `caveman` context; recommended
   `/mode-router:carryover`, then `/clear`, then re-send; to answer here with no
   mode, reply "proceed".* The turn ends there. The notice repeats on **every**
   switch turn — it costs one line, and a forgotten reset costs more.
2. **The mode veto.** `PreToolUse` on `Skill` denies the call if the model makes
   it anyway. The deny reason is descriptive; the procedure is in the notice.

The user decides. **Accepting** the recommendation is the carryover-and-clear the
note is built for ([`HANDOFF-NOTE.md`](HANDOFF-NOTE.md)); the fresh context then
classifies the re-sent request from an empty set and loads the right mode.
**Declining** — "proceed", in any language — makes the model answer that request
with **no mode at all**: plain writing, neither the loaded mode's rules nor the
missing one's. The router recommends and never demands. The refusal is remembered
by the model from the previous message, not by the hook: `UserPromptSubmit` is
stateless, and the word is not one the hook can match across languages. After a
compaction the model may have lost it, and the notice returns — the acceptable
cost of keeping the hook stateless. The next switch turn gets the notice again.

The rule is *one or the other*, whoever asks. A **forced** mode against a
context holding the other one gets the same treatment: the prompt side emits the
switch notice in control-file wording ("the control file forces `ponytail` but
this context holds `caveman`") instead of the invocation, and the veto denies the
call. The file picks the mode of a fresh context; it does not add a second one to
a running context.

The veto stops a `Skill` **call**. A user-typed `/ponytail` never makes one — the
harness expands the body inline — so it walks in past both layers. That is the one
path to a **mixed context**, and it is the user's choice: from then on the turn
applies the mode it classifies to and suspends the other one, in words. Two things
hold there:

- **The suspension is per turn, and only words.** The suspended mode is still
  loaded, just inert for that turn, and the clause denies it *any* influence
  rather than merely asking for one mode: the leak it guards is subtle enough that
  "apply one, not the other" leaves room for it. Wording in this branch has
  measurable and counter-intuitive effects, so it is not rephrased casually.
- **A coding turn is pure `ponytail`.** The one directional clause the router
  carries (`CODING_IS_PURE`) says the explanations and notes around the code read
  as normal writing, not as `caveman`. There is deliberately **no** mirror clause
  for the other direction: the stub it would prevent was measured and does not
  occur, and the obvious wording for it diluted `caveman` instead of defending it
  (ADR-0001).

### History

`0.5.0`–`0.7.0` vetoed the second mode to prevent a style leak between the two
modes. `0.8.0` measured the leak, found none, and dropped the veto: contexts
mixed freely and exclusivity was per turn only
(`docs/adr/0001-drop-the-skill-veto.md`, at the root of the marketplace repo).
`0.10.0` brings the veto back as a **product choice**, not a leak fix: one
context, one mode, and the switch made visible to the user rather than silent
(`docs/adr/0006-one-mode-per-context-by-choice.md`). The measurements of ADR-0001
stand — they are why a mixed context, once the user creates one, is still handled
in words and works. What `0.7.0` got wrong and `0.10.0` keeps in check is the
cost: its veto text was ~62% of every steady-state injection; the switch clause
is a few lines, and the notice the user sees is one.

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

It is also why the "proceed" of a declined reset is the model's memory and not a
flag: a flag written here would have to be consumed here.

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
mode is a standing choice and applies on every prompt regardless — except against
a context that already holds the other mode, where it asks for the reset (above),
and with the same one exception: on a `/carryover` turn the hook asks for no invocation, because that
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
`/clear` between analysis and coding is what the switch notice recommends, and
it re-classifies each phase from an empty set.
