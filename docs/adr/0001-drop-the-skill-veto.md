---
status: superseded by ADR-0006
---

> Superseded in the decision only: the measurements below stand, and ADR-0006
> relies on them for the mixed context it still tolerates.


# Drop the skill veto; keep exclusivity per turn

From `0.5.0` the `mode-router` hook enforced *one mode per context*: `PreToolUse`
denied a second mode skill entering a context that already held the other, and
switching mode meant writing a handoff note and starting a fresh context. In
`0.8.0` the veto is **removed** — the leak it existed to prevent was measured and
does not happen, while the veto cost ~62% of the injected text on every steady-state
turn — and exclusivity is kept where it was always actually kept: **per turn**, by
the suspension clause, with mixed contexts accepted as normal.

## Why it looked necessary

A skill cannot be unloaded (verified: no harness mechanism removes or disables a
loaded skill mid-session). The mode skills declare themselves "active every
response", so a context that has seen both holds two always-on instructions, and
the assumed failure was subtle: `caveman`'s compression bleeding into the prose
*around* the code on a `ponytail` turn. Asking the model to ignore a loaded skill
looked like the weakest possible guarantee, so the router stopped the second one
from entering instead.

Nothing in that argument was measured. The comment in `route.js` calling per-turn
suspension "too weak" was an intuition, and the veto was built on it.

## The measurements

Bench: a throwaway plugin bundling `route.js` plus both mode skills, loaded with
`--plugin-dir`, isolated `XDG_CONFIG_HOME`/`XDG_STATE_HOME`, one fresh session per
arm so no arm inherits the previous answer's style. The measured turn receives
exactly the text `route.js` emits in production for the state under test. The
two-mode state was produced by setting the control file to `off` while both skills
were loaded, then back to `auto` for the measured turn.

Signal: **article density** — Italian articles and articled prepositions per 100
words of prose, code blocks and inline code excluded. `caveman`'s first rule is
dropping articles, so density falls when `caveman` is applied and sits at baseline
when it is not. It is a proxy for "caveman is applied", not a definition.

**Direction 1 — does `caveman` bleed into a coding turn?** (both modes loaded)

| Arm | Prose words | Articles/100 words |
|---|---|---|
| Coding turn with substantial prose | 400 | **14.2** |
| Same, repeated | 488 | **15.4** |
| Same, no mode loaded (baseline) | 429 | 14.9 |
| Non-coding turn | 59 | **5.1** |
| Off-topic one-liner | 51 | **5.9** |
| Non-coding turn, no mode (baseline) | 118 | 14.4 |

The guarded leak is indistinguishable from baseline, twice out of twice. The same
text compresses hard on a non-coding turn, so the suspension is picking the right
mode rather than doing nothing.

**Direction 2 — does `ponytail` stub out a non-coding turn?** Each arm runs a
coding turn first, to build the `ponytail` inertia the symptom presupposes (control
passed: prose in those turns stays at 14.6 / 15.0 / 14.7 against a 12.2 baseline);
the baseline gets the same coding turn without modes.

| Turn | Baseline, no mode | Both modes loaded |
|---|---|---|
| A process decision with concrete constraints | 675 w / 14.8 | 267 w / **6.4** · 282 w / **6.7** |
| An explanation outside the technical domain | 902 w / 14.9 | 331 w / **2.7** |

Judged by hand on the same prompts, the compressed answers are also **complete** —
no stub, no deferral, coverage comparable to the baseline rather than thinner. The
difference is verbosity, not substance.

**The cost of the veto.** Running `route.js` on a `UserPromptSubmit` event for each
state of the loaded-mode set, the text injected *per turn*:

| Loaded-mode set | Injected per turn |
|---|---|
| Empty | 140 words / 939 chars |
| **One mode** — the steady state *with* the veto | **345 words / 2199 chars** |
| Both — the steady state *without* it | 127 words / 841 chars |

About 1250 of those 2199 characters were the instruction that teaches the switch
ceremony (the handoff procedure, its schema, and the skill list). It had to ride
`UserPromptSubmit` and be repeated every turn, because the enforcement channel
could not carry it: a `PreToolUse` deny reason arrives as tool output, and in a
direct test the model refused to act on it — correct behaviour against prompt
injection, and the reason instructions and enforcement were split in the first
place. So the veto cost **−62% of the steady-state text, forever**, to save the
~1.7K tokens the second skill body costs **once** when it is invoked.

## Considered options

- **Keep the veto and pay for it** — rejected: it prevents a leak that does not
  occur, and it makes the un-measured direction *worse*, not better. With
  `ponytail` loaded and a non-coding turn arriving, the veto blocks `caveman` and
  leaves `ponytail` to answer alone: exactly the overspill it was feared for, plus
  the ceremony on top.
- **Unload the second skill instead of denying it** — rejected: no such mechanism
  exists.
- **A third outcome, "no mode this turn"**, so a two-line question in a coding
  context loads nothing — rejected: a loaded skill sits in the transcript and is
  paid for once at invocation (~1.7K tokens), not per turn, so the saving is small
  and one-off, while the new outcome brings a machine of its own (who judges, on
  what signal, what the hook emits, where the boundary with a real switch lies).
  An off-topic question in a coding context is still shaped by `caveman`; that is
  the intent, not a defect.
- **A mirror clause** protecting `caveman` from `ponytail`'s minimalism, symmetric
  to `CODING_IS_PURE` — rejected on measurement. No stub occurs (above), and the
  natural wording ("it answers the question in full — `ponytail`'s minimalism does
  not shorten it into a stub or defer the answer") did the opposite of what it
  said: density rose from 6.4 to 11.9 and from 2.7 to 8.4, always toward the
  no-mode baseline, and volume from 267 to 697 words. "Answer in full" reads as
  *do not compress*, colliding with `caveman`'s first rule instead of defending it.
  A reformulation that names the style keeps density in range (8.7 / 5.6 and 2.9)
  at about +25% volume across 3 arms of 3; it is not adopted, because a clause here
  has to be paid for and no symptom asks for it — but it is worth keeping should
  the stub ever appear in use:

  ```js
  const NONCODING_IS_PURE =
    ' And a non-coding turn is pure `caveman`: cover the whole question — no stub, ' +
    'no deferral — IN caveman\'s compressed style, not in normal prose.';
  ```

  The asymmetry is deliberate: `CODING_IS_PURE` answers a leak seen in use, the
  mirror answered symmetry alone. A silent style dilution costs tokens forever and
  nobody notices; a stub gets reported the first time it happens.

## Limits of the evidence

n = 2 on the decisive arms, n = 1 on several others; one model
(`claude-opus-5[1m]`); prompts in Italian, two registers of non-coding turn. Article
density is a proxy. The two-mode state was produced by disabling the veto through
the control file — the real fallback path, but rare by construction while the veto
existed.

## Consequences

- `PreToolUse` is **removed**, from `route.js` *and* from `hooks/hooks.json`. It has
  no other consumer: `PostToolUse` keeps feeding the set on its own. Removing the
  branch without the registration would not leave dead code but an active bug — the
  script's tail has no guard of its own, so the event would fall through and print
  routing text on every `Skill` call. A guard (`hook_event_name !== 'UserPromptSubmit'`
  → exit) goes in ahead of the tail, so the tail belonging to one event stops being
  a convention held up by the preceding branches.
- The injected text collapses to **two** branches: empty set (full rules, invoke
  now, pending-note announcement) and non-empty set (conditional invocation plus
  suspension). One loaded mode and two are the same state to answer in.
- The switch ceremony survives as something the **user** chooses, not something the
  router imposes — see `0002-handoff-note-as-typed-command.md`.
- Per-session state files are unchanged and stay valid: the set is still what tells
  *invoke* from *do not re-invoke*.
- The deny-reason channel disappears, and with it the router's reliance on the
  undocumented claim that the model will not act on instructions arriving as tool
  output. That claim was only ever verified anecdotally; it is no longer
  load-bearing.
