---
status: accepted
---

# A dispatch turn routes the work, not the dispatch

`auto` classified **every** prompt, slash commands included: ADR-0006's context
holds one mode, and the first mode in wins it. A slash-command prompt is the one
kind of prompt that holds no request. `/wayfinder:wayfinder 1 82` is a skill name
and two numbers; what the model is about to read is the skill's body, and what the
user is about to do is unstated. Classified anyway, it falls to the second rule —
"anything else" — and `caveman` enters the context.

The work then arrives, and it is code. `ponytail` is the mode for it, and the mode
the context can no longer take: the switch notice on the prompt side, the veto on
the tool side. The router had asked for the wrong mode one turn earlier and then
enforced it. Observed on `/wayfinder:wayfinder 1 82` and again, in the session that
produced this ADR, on `/writing-for-agents:writing-for-agents` — a skill invoked to
edit a hook, routed to `caveman`, followed by a coding turn that could only be
answered with no mode at all.

This is also the front half of the **mid-turn arrival** ADR-0009 patched from
behind: there the model classifies the dispatch, invokes, and reaches for the other
mode inside the same turn. ADR-0009 made that denial legible; it could not stop the
turn from being routed on a launcher in the first place.

## Decision

A prompt whose leading token is a slash command — other than a mode slash or
`/carryover`, which keep the branches they already own — is a **dispatch turn**,
and `auto` treats it as one:

- The classification is pointed at the **work the dispatched skill leads to**,
  never at the dispatch. Loading the skill, its setup and its own questions are
  named as not being the work, because a skill getting under way is the thing
  most easily mistaken for it.
- The invocation is **deferred, not dropped**: the mode is invoked the moment the
  work starts — later in the same turn when the skill does its work there, on a
  later turn when the work arrives then.

`CLASSIFY` and `RESET_TAIL` keep their exact wording for prose turns; the dispatch
turn gets its own head and tail (`LAUNCH_CLASSIFY`, `LAUNCH_TAIL`), and the two
routing rules they share live in one constant (`RULES`) so the two heads cannot
drift apart. Everything downstream of the head — the switch clause, the veto, the
suspension in a mixed context, the handoff announcement, forced modes and `off` —
is untouched.

## Considered options

- **Stay silent on a dispatch turn**, the way a mode slash already is. Cheapest,
  and wrong for the many slash commands that do their whole work in the turn that
  dispatches them: those would run with no mode at all, and the next prompt would
  route from an empty set as if nothing had happened. Deferral gets the same
  protection without giving up the turn.
- **Classify only when the arguments read as prose** — defer `/wayfinder 1 82`,
  route `/tdd add validation to the parser`. It keeps a mode on the turns whose
  arguments state the work, at the price of a heuristic on natural language that
  is wrong in both directions, and of a rule the user cannot predict from the
  outside. Deferral covers the prose case anyway: the work is in the prompt, so
  the model classifies it the moment it starts.
- **An allow-list of skills that dispatch rather than work.** Accurate per entry,
  and a list the user has to maintain against every skill they install.
- **Force the mode before launching a workflow**, which ROUTING.md already
  recommends for per-phase control. That is a fix for the *phases*, not for the
  launch, and it asks the user to compensate by hand for a classification the
  router should not have made.

## Consequences

- The wrong mode can still be locked in — by the first turn that carries actual
  work, which is the turn that should decide it. What is gone is the mode locked
  in by a turn that carried none.
- Dispatch turns pay `PRECEDENCE` again when the set is empty, as prose turns do:
  the deferral is an instruction, so it needs the same clause about how to resolve
  a conflict. Steady-state injections are unchanged.
- `LAUNCH_CLASSIFY` and `LAUNCH_TAIL` are injected text, so ADR-0003's eval
  trigger fires. `route.test.js` covers what a string can prove — the head, the
  deferral, both set states, the two exceptions still silent — and the eval suite
  stays the layer that would show a deferred invocation arriving late or not at
  all. That suite is still not exercisable here (`claude plugin eval`, early
  access), so the trigger is recorded rather than run, as in ADR-0009.
- ADR-0009's mid-turn arrival becomes the normal path on a dispatch turn rather
  than the exception: the model is now *told* to invoke mid-turn when the work
  starts there. Its deny reason stands unchanged and is what still catches the
  second mode.
- The `/wayfinder:wayfinder 11` prompt that set up the mid-turn-arrival test no
  longer asks for an invocation; that test drives a prose prompt instead.
