---
status: accepted
---

# Each source repo is whole or curated

An audit of the catalog against upstream turned up dozens of skills that exist
upstream and have no entry here. Almost all of them were already present at the
pinned `sha` when their siblings were added — `printing-press-amend`, `-import`
and `-reprint` were there when the printing-press series landed (#16) — so their
absence looked like a choice. Nothing recorded it. The next audit would have to rebuild the
reasoning skill by skill, and `/add-external-skill update` would undo it: its
update mode turns every new upstream folder into an entry, which on
`Jeffallan/claude-skills` means proposing sixty skills against a catalog that took
ten.

Some turned out to be oversights, and are added alongside this ADR:
`nextjs-on-cloudflare`, the only `cloudflare/skills` skill without an entry;
`wait-what`, the only `mattpocock/skills` productivity skill without one; and
`printing-press-reprint`, which `printing-press` (phase 3) and
`printing-press-polish` hand off to when a CLI already exists — without it
`printing-press-bundle` stopped at that hand-off.

The printing-press series had the opposite problem too. `printing-press-publish`,
`-amend` and `-import` are bound to `mvanhorn/printing-press-library`, a third
party's public library: publish forks it and opens a PR, amend opens patch PRs
against it (the repo is hardcoded), import pulls CLIs out of it.
`printing-press-retro` files findings against the Press itself, for its
maintainers. None of that serves CLIs built and kept locally, so `-publish` and
`-retro` leave the catalog and all four are exclusions. The bundle keeps what
creates and maintains a CLI locally: `printing-press`, `-polish`, `-score`,
`-output-review`, `-reprint`. The handoffs to the excluded skills become dead
suggestions — `printing-press` and `-polish` name them as optional next steps;
`-reprint` calls `-import` only when the CLI is not on disk. A separate
create/maintain bundle split was considered and dropped: `-reprint` hands back to
`/printing-press`, so a maintain bundle would contain the create one.

## Decision

Every git-subdir source repo is one of two kinds, and the kind decides what
happens to a skill upstream adds:

- **Whole source** — every skill the repo ships is catalogued. A new upstream
  skill gets an entry, unless it is a **catalog exclusion** listed below.
- **Curated source** — only skills picked by hand are catalogued. A new upstream
  skill is **reported, never added**; a human decides.

A **catalog exclusion** is an upstream skill deliberately left without an entry,
with its reason. Update mode neither adds nor reports one.

Not every `SKILL.md` upstream is a skill of the repo. Copies of an already-found
skill mirrored for another harness (`.openclaw/`, `.cursor/`, `.claude/skills` next
to a canonical `skills/`, `cli/assets/`, `plugins/<name>/skills/` next to a
canonical `skills/`) and fixtures (`testdata/`, `tests/`, `benchmarks/`) are
ignored without being listed. For a whole-plugin entry the unit is the plugin, not
the skills inside it.

The two tables below are maintained, not frozen: `/add-external-skill` classifies
a new source repo here when it adds one, and a skill declined later is appended to
the exclusions.

### Source repos

| Repo | Kind | Notes |
| --- | --- | --- |
| `mattpocock/skills` | whole | `skills/in-progress/` is unreleased work, not a skill of the repo |
| `Leonxlnx/taste-skill` | whole | |
| `cloudflare/skills` | whole | |
| `mvanhorn/cli-printing-press` | whole | |
| `antonbabenko/terraform-skill` | whole | single skill |
| `mvanhorn/last30days-skill` | whole | single skill |
| `cloudflare/security-audit-skill` | whole | single skill |
| `pbakaus/impeccable` | whole | whole-plugin entry |
| `cathrynlavery/diagram-design` | whole | whole-plugin entry |
| `Jeffallan/claude-skills` | curated | |
| `antfu/skills` | curated | |
| `mcollina/skills` | curated | |
| `wshobson/agents` | curated | whole-plugin entries, picked per plugin |
| `nextlevelbuilder/ui-ux-pro-max-skill` | curated | |
| `mvanhorn/cli-printing-press` | `printing-press-publish`, `printing-press-amend`, `printing-press-import` | Bound to the third-party public library `mvanhorn/printing-press-library` |
| `mvanhorn/cli-printing-press` | `printing-press-retro` | Files findings for the Press's maintainers |
| `juliusbrussee/caveman` | curated | `mode-router` depends on the core mode only |
| `dietrichgebert/ponytail` | curated | `mode-router` depends on the core mode only |
| `filippolmt/proximo` | curated | |
| `tt-a1i/archify` | curated | |

### Catalog exclusions

| Repo | Skill | Reason |
| --- | --- | --- |
| `mattpocock/skills` | `migrate-to-shoehorn` | Tied to one TypeScript test library |
| `mattpocock/skills` | `scaffold-exercises` | Tied to the author's course format |
| `juliusbrussee/caveman` | every skill but `caveman` | Companions trigger on their own; a context holds one mode (ADR-0006), and `caveman-review` overlaps `code-review` |
| `dietrichgebert/ponytail` | every skill but `ponytail` | Same as `caveman`'s companions |
| `filippolmt/proximo` | `.claude/skills/*` | Skills for developing proximo, not for using it |
| `tt-a1i/archify` | `archify-review` | For archify's maintainers: triages its issues and links its `REVIEWING.md` by relative path |

## Considered options

- **An exclusion list alone.** Records today's choices, but says nothing about the
  next skill upstream adds; every curated repo would need its full remainder
  listed, and would go stale at the first upstream release.
- **An `excluded` field in `scripts/catalog-meta.json`.** Machine-readable, but it
  means teaching `gen-readme.js` a field that has nothing to do with the README,
  and the reasons read better as prose.
- **Record nothing.** Every audit rebuilds the reasoning, and update mode keeps
  proposing sixty skills.

## Consequences

- `/add-external-skill update` reads this ADR: on a whole source it adds new skills
  minus the exclusions, on a curated source it lists them for a human.
- An audit that finds an upstream skill with no entry has three possible outcomes:
  an exclusion here, a curated source, or an oversight to fix.
