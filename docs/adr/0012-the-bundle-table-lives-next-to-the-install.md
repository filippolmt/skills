---
status: accepted
---

# The bundle table lives next to the install

A **bundle** is a local plugin that ships no artifacts of its own: its
`plugin.json` carries only `dependencies`, so installing it pulls in a skill plus
everything that skill calls at runtime. Seven exist — `code-review-bundle`,
`implement-bundle`, `triage-bundle`, `wayfinder-bundle`, `printing-press-bundle`,
`grill-with-docs-bundle` and `improve-codebase-architecture-bundle`.

Until now they were **invisible**. `isBundle()` in `scripts/catalog.js` derives
bundle-ness from the absence of a `skills/`, `commands/`, `hooks/` or `agents/`
directory, and `gen-readme.js` folds that set into the `omit` list, so no bundle
reaches the catalog projection. The comment in `catalog.js` stated the reasoning
outright: "the README has no row to give it."

That was wrong in a specific way. The README told a reader to
`/plugin install code-review`, and a reader who does that gets a skill whose two
axis sub-agents stall — the failure `agent-report-guard` exists to prevent. The
bundle is the fix, and the reader had no way to learn it existed. Worse, the
bundles are not all about that guard: `triage-bundle` and
`grill-with-docs-bundle` carry no guard at all, only the sibling skills their
main skill invokes (`grilling`, `domain-modeling`). Nobody guesses that
`grill-with-docs` calls `domain-modeling`. The mechanical fact needs to be
written down somewhere.

## Decision

- The README gains a **second** generated region,
  `<!-- bundles:start -->` / `<!-- bundles:end -->`, holding a table of every
  bundle and the entries its `dependencies` name. `replaceBetweenMarkers` is
  parameterised on its marker pair to serve both regions.
- That region sits inside `## Installing skills`, **next to the install
  instructions** — not in `## Available skills`, a hundred-odd lines below.
  Proximity is the whole point: the reader deciding between `code-review` and
  `code-review-bundle` must see what the bundle brings at the moment of the
  decision.
- The two regions carry **disjoint** content. A bundle appears in the bundle
  projection and never in the catalog projection; the `isBundle()` set that used
  to only subtract now also selects. `CONTEXT.md` names the new region a
  **bundle projection** to keep that disjointness sayable.
- The table's cells list the `dependencies`, not the bundle's `description`. The
  description is a prose sentence and reads badly in a table cell; the dependency
  list is the mechanical fact a table is for. Both stay derived, so neither drifts.

## Considered options

- **Drop the bundles from `omit` instead.** Four lines shorter than this
  decision: delete the `.concat(catalog.plugins.filter(isBundle)…)` and the seven
  bundles fall into the `**Local:**` list with their descriptions, which already
  read as complete sentences. No new code, no new test, no second marker.
  Rejected on placement alone — the list lives in `## Available skills`, far from
  the section that explains what a bundle is, and the reader who needs the
  information is reading the install instructions.
- **Hand-write the table.** Rejected: it goes stale at the first bundle added or
  dependency changed, silently, with nothing in CI comparing it. Same objection
  the derived `isBundle()` was introduced to answer.
- **Prose only, no list.** Rejected: the runtime call graph — which sibling skills
  each main skill invokes — is exactly the part a reader cannot infer, and prose
  that enumerates seven dependency lists is a table with worse formatting.
- **Put the bundles in the skills table.** Rejected: two rows for the same skill,
  one of them a wrapper, in a table read for discovery.

## Consequences

- `gen-readme.js --check` now guards two regions, so a bundle added or a
  dependency changed without regenerating fails CI the same way a catalog entry
  does.
- `scripts/gen-readme.test.js` covers the new renderer directly. `--check` only
  asserts that README and catalog agree; a renderer emitting a wrong table
  regenerates it wrongly and `--check` passes. The test is what looks at content.
- A local plugin that ships no artifacts **and** declares no `dependencies` is
  now renderable and meaningless. It renders with an empty cell rather than
  throwing: the case is a mistake to notice in review, not a build to break.
- The `omit` list in `catalog-meta.json` stays empty and stays editorial — the
  place for an entry a human decides to hide for a reason no rule derives. This
  decision does not put anything back into it.
