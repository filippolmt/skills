---
status: accepted
---

# The veto's deny reason carries the procedure, and the mid-turn arrival is why

ADR-0006 brought the `PreToolUse` veto back as the net under the switch notice:
the routing text tells the model not to invoke the second mode, and the veto
denies the call it makes anyway. Its deny reason was written as *descriptive
only* — "Answer this turn as the routing text says" — on the assumption that the
turn had already been given the procedure.

That assumption holds only for a turn routed from a set that already held a mode.
Two transcripts from 2026-09-07 (`soccer-prediction`, `toolbox`) show the shape it
misses, the **mid-turn arrival**:

1. The turn is routed from an **empty set**, so the routing text asks for an
   invocation and carries no switch clause.
2. The model classifies, invokes that mode, and `PostToolUse` records it.
3. Still inside the same turn the work shifts — a dispatched skill turns out to be
   coding — and the model reaches for the other mode.
4. The veto denies it, correctly, and points at a routing text that had asked for
   the opposite.

The context stayed single-mode, so the router's guarantee held. What the user saw
was an `Error:` and what the turn got was no instruction at all.

## Decision

The deny reason states the whole procedure itself: do not retry, finish this turn
with the loaded mode, and — if the request really needs the other one — the switch
notice, in the user's language, recommending `/mode-router:carryover`, then
`/clear`, then re-sending, with "proceed" to decline. Wording follows
`switchClause()` so the user meets one notice, not two.

`CLASSIFY`, `PRECEDENCE`, `RESET_TAIL`, `suspendClause()` and `CODING_IS_PURE`
are untouched, so the ADR-0003 eval trigger does not fire.

## Considered options

- **Keep the deferral.** Free, and wrong exactly where it is read: on a mid-turn
  arrival the text it points at is the invocation request.
- **Bind the classification to the whole turn** — a clause in `CLASSIFY` saying
  the mode invoked first holds until the next prompt. This stops the call at the
  source rather than catching it, but it changes injected text (ADR-0003's
  trigger, and `claude plugin eval` is still early access here) and pays on every
  turn for an event seen twice. Held as the follow-up if the denial turns
  frequent.
- **Let the mid-turn call through** and record a mixed context. Rejected by
  ADR-0006: a context holds one mode whoever asks, and the model changing its mind
  mid-turn is not the user choosing.

## Consequences

- The reason is about twice as long. It is not a steady-state injection — the cost
  ADR-0001 measured on `0.7.0`'s veto text (~62% of every injection) — but a cost
  paid only on the turn that fires it, which is the turn that needs it.
- `route.test.js` carries the mid-turn arrival as its own case: a turn routed from
  an empty set, a mode loaded, then the other one denied.
- The deny reason joins ADR-0003's eval trigger. A descriptive string needed no
  behavioural check; one carrying a procedure does, because "the model emits the
  notice and stops" is not something `route.test.js` can assert. The suite is
  still not exercisable here (`claude plugin eval`, early access), so the trigger
  is recorded rather than run — which is the state ADR-0003 already describes.
- The switch notice now has two emitters, `switchClause()` and the veto. They are
  held together by that test, not by a shared string: the veto's copy has to stand
  alone, so factoring it out would put a sentence fragment in two callers.
