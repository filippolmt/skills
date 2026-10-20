---
status: accepted
---

# Report upstream descriptions that changed since review

Renovate moves an entry's `ref` and `sha` and nothing else. The catalog
`description` summarises upstream, and `/add-external-skill update` rewrites it
only when upstream's meaning changed — but nothing told anyone to run it. So
descriptions drifted: impeccable's said "23 commands" while upstream said 24 from
`skill-v4.5.2` on, through four Renovate bumps. The first run of this check found
23 entries whose upstream description had changed since review. Some changed in
meaning (`wrangler` now sends new projects to the `cf` CLI); some only in
punctuation (`triage`).

## Decision

`scripts/check-upstream-descriptions.js` runs as a third leg of the
`whole-sources` workflow and keeps one issue open, like ADR-0024 and ADR-0026.
For each `git-subdir` entry it compares the upstream description at two shas:

- **reviewed** — the last sha a non-Renovate commit set or rewrote the entry at,
  read from the catalog's git history. A human or `/add-external-skill` bump is a
  review; a `renovate[bot]` bump is not. An entry's
  `descriptionReviewed[<name>]` in `scripts/catalog-meta.json`, when present,
  replaces it: that is how a review that kept the text is recorded.
- **pinned** — the entry's current `sha`.

The upstream description is a plugin manifest's `description`, else the
`SKILL.md` frontmatter `description:` block taken raw, continuation lines
included, so a folded description that changes below its first line still
differs. Files come from `raw.githubusercontent.com`, which spends no API quota.

Each finding carries the catalog text and both upstream texts, so the issue is
reviewable without a second fetch. Upstream text is untrusted: each sits in a fence
longer than any backtick run in it. Past 60000 characters (GitHub caps an issue
body at 65536) the report drops every text and keeps every finding, since a failed
issue edit would leave the issue stale.

It reports and never edits: whether a reworded upstream sentence warrants a new
summary is a judgement. A rewrite is then reviewed against the upstream artifact,
not only its description (`CODING_STANDARDS.md` § External entry descriptions).

## Consequences

- The workflow checks out full history (`fetch-depth: 0`) for every leg.
- Any upstream change to the description text is a finding, punctuation
  included; the review acknowledges it in `descriptionReviewed`. The check
  cannot tell a reword from a new meaning, so it does not try.
- An acknowledgement wins over the history. A description rewritten later by
  hand, without updating `descriptionReviewed`, is compared from the older
  acknowledged sha and reported again; recording the new sha clears it.
- An entry whose folder upstream deleted reads as unreadable and is skipped:
  pruning it is regeneration's job (ADR-0015).
