---
status: accepted
supersedes: ADR-0001
---

# One mode per context, by choice — the veto returns as a product decision

ADR-0001 dropped the `PreToolUse` veto in `mode-router` `0.8.0` because the
leak it existed to prevent — one mode's style bleeding into the other's turn in
a context holding both — was measured and does not happen. That measurement
stands. `0.10.0` brings the veto back anyway, for a reason 0001 never weighed:
the user wants **one context, one mode**, and wants a switch to be **visible**
rather than a second skill body silently entering the context.

## Decision

- A context holds the first mode that enters it. The router never loads the
  second one.
- A request classifying to the missing mode is a **mode switch**. The turn is
  answered with a one-line **switch notice**, in the user's language: which mode
  the request wanted, which the context holds, the recommendation
  (`/mode-router:carryover`, then `/clear`, then re-send), and the way to decline
  ("proceed"). Every switch turn, not once per session.
- Declining gets the request answered with **no mode at all** — not the loaded
  one. The refusal is the model's memory of the previous message, not hook state.
- `PreToolUse` on `Skill` denies the call if the model makes it anyway. `off`
  vetoes nothing, and a forced mode is waved in — but only that mode: a forced
  `caveman` does not let a stray `ponytail` call open a mixed context. As in 0.7.0.
- A user-typed `/caveman` or `/ponytail` is not intercepted — it cannot be, the
  harness expands it inline — and is the one path to a mixed context. There the
  per-turn suspension of 0.8.0 applies unchanged, because 0001 showed it works.

## Considered options

- **Keep 0.8.0** (mixed contexts, suspension only). Measurably fine for output
  style; rejected because the user's requirement is about the context, not the
  output: a session that starts as coding should stay a coding session until
  they say otherwise.
- **Notice only, no veto.** Cheaper, but a single stray `Skill` call makes the
  context mixed for good. The veto is the net under the notice.
- **Hook-matched "proceed".** Would let the hook emit a different text after a
  refusal, but the word arrives in any language and `UserPromptSubmit` must stay
  a pure function of its input (ROUTING.md, "Why UserPromptSubmit writes
  nothing"). The model already has the previous turn; it remembers.
- **Notice once per session, then silence.** Rejected by the user: a forgotten
  reset should keep being pointed out. One line per switch turn is the cost.

## Consequences

- A coding session that needs a reasoning turn costs one round-trip (the notice,
  then "proceed" or the reset). This is the feature.
- After a compaction the model may forget a "proceed" and the notice returns on
  the next switch turn. Accepted: the alternative is hook state.
- 0.7.0's veto text was ~62% of every steady-state injection (ADR-0001). The
  0.10.0 switch clause is a few lines, asserted short in `route.test.js`; the
  notice the user sees is one.
