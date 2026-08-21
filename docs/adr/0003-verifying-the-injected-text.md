---
status: accepted
---

# Verify the injected text on two layers, and keep the stochastic one out of CI

What `route.js` emits is a pure function of the hook event and the loaded-mode
set; what the **model** does with that text is not. The two halves get different
machinery: `route.test.js` asserts the exact text emitted for every state — free,
deterministic, already in CI — and a small `evals/` suite checks that the emitted
text actually produces the intended style, run **by hand** before a release that
touches the injected text. Its thresholds are relative to a no-plugin baseline arm
measured in the same run, never absolute.

This ADR defines the proofs. Writing the case files is implementation and belongs
with the `0.8.0` code change.

## Which layer gets what

**If an assertion can be written against the emitted string, it is a test, not an
eval.** Tests cost nothing and never flake, so every deterministic property stays
in `route.test.js`: which of the two branches of `invocationTail()` fires for a
given set, the silence on a `/handoff` turn and the skill list it emits instead,
the `off`/forced config paths, the archival backstop, the sweep.

An eval is only for the questions no string can answer: does a `caveman` turn come
out compressed, does a coding turn stay clean of it, does a compressed answer still
answer the whole question.

## The metric, defined exactly

**Article density** — Italian articles and articled prepositions per 100 words of
prose. It is a *proxy* for "`caveman` is applied", not a definition of it:
dropping articles is that skill's first rule, and it is the one stylistic effect
that survives automatic counting.

Computed as:

1. Strip fenced code blocks (` ``` … ``` `, non-greedy, dot-matches-newline) and
   inline code (`` ` … ` ``) from the response. What is left is *prose*.
2. Lowercase, then tokenise with `[A-Za-zÀ-ÿ']+`.
3. Count tokens belonging to this set, plus any token that ends in `'` whose stem
   is in it:

   ```
   il lo la i gli le un uno una
   del dello della dei degli delle dell
   al allo alla ai agli alle all
   dal dallo dalla dai dagli dalle dall
   nel nello nella nei negli nelle nell
   sul sullo sulla sui sugli sulle sull
   col coi
   ```

4. Density = 100 × articles ÷ prose tokens.

Two properties of that definition are deliberate. It **misses elisions written
closed up** (`dell'acqua` tokenises as one word and does not count), which pushes
every measurement down by the same bias — harmless, because every threshold below
is a ratio between two arms measured identically. And it is **language-specific**:
these thresholds are only meaningful for Italian responses. A suite in another
language needs its own word set and its own re-measured baselines.

## Thresholds

Always **relative to the no-plugin arm of the same run**, never an absolute number:
an absolute cut is tuned to one model and one language, and lies the first time
either changes.

| Case asserts | Passes when | Worst observed |
|---|---|---|
| `caveman` is applied | density ≤ **55%** of the baseline arm | 45% (6.7 vs 14.8) |
| No bleed into a coding turn | density ≥ **85%** of the baseline arm | 95% (14.2 vs 14.9) |

Both margins are set against the worst arm measured while deciding to drop the
veto (see `0001-drop-the-skill-veto.md`, which carries the full tables).

Density alone cannot tell a compressed answer from a stub, and the primary signal
in that work was a human reading both. Its only automatable form is a judge, so
every case on a **substantial non-coding turn** also carries an LLM grader asking
whether the whole question was answered or part of it deferred.

## Runs, and what counts as a failure

`runs: 5` on every stochastic case, passing at **0.8** (4 of 5). The runner's
default is 3 runs at a threshold of 1.0 — three coin flips where 2/3 and 3/3 are
not distinguishable, scoring a stylistic property that will occasionally miss.

**A case that lands at 3 of 5 is not re-tuned.** The threshold does not move; the
case is rewritten or deleted. A wobbling case is evidence about the *text*, not
about the number — the mirror-clause episode in `0001` showed a clause can read
perfectly and do the opposite of what it says, so a suite that can be nudged into
green is a suite that hides exactly the failure it exists to catch.

## Where they run

**Not in CI.** The suite is gated, paid, stochastic and judged by a model; a build
that goes red because today's model is wordier is a build people learn to ignore.
`plugins/*/hooks/*.test.js` stays the CI contract.

The trigger is a release that changes the **injected text** — `CLASSIFY`,
`PRECEDENCE`, `RESET_TAIL`, `suspendClause()`, `CODING_IS_PURE`, or either branch
of `invocationTail()`. The suite lives in `plugins/mode-router/evals/` with a
`README.md` naming that trigger, the command, and these thresholds. That directory
ships to everyone who installs the plugin, which is a second reason to keep it
small. Runs are bounded with `--max-cost-usd`: five cases × 5 runs × two arms is
about 50 model runs.

## The cases

1. **Empty context, coding prompt** — `ponytail` is invoked. Ablation on, with the
   invocation itself as a `with-only` grader (`tool_used: Skill`).
2. **Empty context, non-coding prompt** — `caveman` is invoked, density ≤ 55%.
3. **The mandatory one: the second mode entering.** Multi-turn — a coding turn,
   then a substantial non-coding turn. Density ≤ 55% *and* the completeness judge.
   This is the branch nothing has ever measured: the inertia of the mode already
   loaded is at its maximum exactly on the turn the other one arrives, and the
   `0.8.0` design injects the suspension there for the first time.
4. **Mixed context, coding turn** — density ≥ 85%. This is the leak the veto was
   built to prevent, now guarded by words alone.
5. **Mixed context, non-coding turn** — density ≤ 55% and the completeness judge.
   The regression guard on the *absence* of a mirror clause: if the stub ever does
   appear in use, this is the case that shows it, and `0001` holds the wording to
   adopt when it does.

Cases 4 and 5 are already mixed once case 3's first turn has run, so the three are
assertions over two conversations rather than three independent setups.

**Not an eval**: the `/handoff` turn. "The hook says nothing about routing and
emits the skill list" is an exact string, so it is a `route.test.js` assertion.

### Seeding the state

The decisive cases need modes already loaded, and that state lives in
`session-<id>.json` under an id the runner generates. A `scaffold_script` would
have to know that id to write the file, and whether the runner exposes it cannot
be checked here (below). So the cases **seed themselves from inside**: the first
turn loads the first mode by being a coding turn, exactly as a real session does.
No dependency on runner internals, and a more faithful reproduction of how mixed
contexts actually arise.

If the case format turns out not to support multi-turn conversations, the fallback
is the manual bench, **not** `scaffold_script`: the bench exists and has been used
twice, the scaffold is a bet on an API nobody has been able to inspect.

## Interim: the tool does not run here

Verified 2026-08-21: `claude plugin eval`, in every form (`init --bare`, and a run
against a plugin target), prints `` `plugin eval` is currently in early access ``
and exits 0 without doing anything. The bar this ADR describes is therefore
**authored but not exercisable** on this account.

Until it is, the executable bar is `route.test.js` plus the manual bench that
produced every measurement in `0001`:

- A throwaway plugin bundling `route.js` and both mode skills, loaded with
  `--plugin-dir` (headless does not load the user's own plugins, and marketplace
  cache directories hold only a `SKILL.md`, not a plugin root).
- `XDG_CONFIG_HOME` and `XDG_STATE_HOME` pointed at scratch directories, so a run
  never touches real state.
- One fresh session per arm, so no arm inherits the previous answer's style.
- To produce a two-mode context: control file at `off` while both skills are
  loaded, verify the set actually holds both, then back to `auto` for the measured
  turn.
- Where `ponytail` inertia is the point, a coding turn first — and the baseline arm
  gets that same coding turn with no modes, so the comparison is at equal context.
- Density computed as defined above, on the response text of the measured turn.

## Limits carried forward

Every threshold here derives from arms with n = 2 on the decisive case, a single
model (`claude-opus-5[1m]`), and prompts in Italian. They are calibrated, not
proven. The first suite run on a different model is expected to re-measure the
baseline before trusting the ratios — which is the reason the thresholds are
ratios in the first place.
