# External entries after the merge

`/add-external-skill` covers adding and updating an entry. This doc covers what
happens to the catalog afterwards, and the checks that report upstream drift.

## Projections

One catalog, `.claude-plugin/marketplace.json`, feeds every projection:

| Projection | Generator |
| --- | --- |
| README *Available skills* catalog and the bundle table under *Installing skills* (ADR-0012) | `node scripts/gen-readme.js` (`--check` compares both regions) |
| pi tree at `skills/` | `node scripts/gen-skills-tree.js` |
| bundle filter snippets | `node scripts/gen-pi.js` |
| Codex packages under `.agents/plugins/` | `node scripts/gen-codex.js` |

`scripts/distribution-meta.json` holds only the cross-harness facts the catalog
cannot express: runtime edges, adaptations, unsupported dispositions and
fallbacks. `node scripts/gen-skills-tree.js --verify-paths` fails on any distribution artifact with no Codex and
pi outcome. It builds the pi projection, overlays included, in a temporary
directory, and generates `docs/distribution-parity.md` from that inventory.

## Regeneration

After a merge, CI's `regenerate` workflow regenerates the projections in its own
PR, which merges itself once `validate` passes (ADR-0011). This keeps a `sha` bump
a one-line diff. A tree that fails `validate` turns the run red and leaves the PR
open, and the catalog stops advancing until someone fixes it.

It pushes with the **regeneration token** and **prunes** entries whose folder
upstream deleted or renamed; both terms are defined in `GLOSSARY.md`.

## Upstream drift reports

The `whole-sources` workflow keeps one issue open per finding until an entry or
an exclusion resolves it. Each report has a local equivalent:

| Finding | Script | ADR |
| --- | --- | --- |
| A skill added upstream in a **whole** source (ADR-0014) | `node scripts/check-whole-sources.js` | 0024 |
| An upstream description that changed since review | `node scripts/check-upstream-descriptions.js` | 0029 |
| A branch pin whose repo now publishes tags | `node scripts/check-branch-pins.js` | 0026 |
