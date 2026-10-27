---
name: add-external-skill
description: "Add or update external skills, their Codex/pi outcomes, and the generated catalog. Usage: /add-external-skill <owner/repo> [path] [name] | /add-external-skill update"
---

Keep the marketplace catalog, cross-harness distribution metadata, and generated
documentation in sync with upstream external skills.

Arguments: `$ARGUMENTS`
- `<owner/repo> [path] [name]` → **add mode** (default).
- `update` (optionally `update <owner/repo>` to scope to one repo) → **update mode**.

Granularity is the CLAUDE.md rule. Default `name` to the skill folder's basename
for a per-skill entry, or the upstream manifest's name for a whole-plugin entry.
If Claude rejects that name as reserved, choose a descriptive catalog alias and
report it; keep the upstream source unchanged. Validate the new catalog entry
before regenerating the README, using the existing `claude plugin validate .`.

## Fetches

Both modes use these. `HEAD` resolves the repo's default branch, so `main` vs
`master` is never a guess.

Skill folders in a repo:
```bash
curl -fsSL "https://api.github.com/repos/<owner>/<repo>/git/trees/HEAD?recursive=1" \
  | jq -r '.tree[] | select(.path | endswith("/SKILL.md")) | .path | sub("/SKILL.md$";"")'
```
Latest tags (does this repo publish semver tags?):
```bash
curl -fsSL "https://api.github.com/repos/<owner>/<repo>/tags?per_page=5" | jq -r '.[].name'
```
The SHA a `ref` resolves to — `HEAD` for a branch pin, the tag name for a tag pin:
```bash
curl -fsSL "https://api.github.com/repos/<owner>/<repo>/commits/<ref>" \
  -H "Accept: application/vnd.github.sha"
```
A skill's upstream frontmatter `description` — the **one-liner**, usually its
first sentence:
```bash
curl -fsSL "https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>/SKILL.md"
```
The upstream author comes from the source that owns the attribution: its plugin
manifest first, then its licence, then the GitHub owner's profile. Preserve
multiple credited authors; do not substitute the marketplace owner.

If `curl` is blocked/redirected here, fetch the same URLs via any HTTP tool — the
endpoints are identical.

## Pinning the `ref`

Renovate updates an entry only when its `ref` has one of two shapes — one
`customManager` in `renovate.json` per shape:

- **Tag** — `vX.Y.Z`, optionally prefixed (`skill-v4.1.2`). Tag and `sha` bump
  together. **The default when the repo publishes semver tags**, and what most
  entries here use. The prefix names the tag series, so a repo publishing
  several (`cli-v*`, `ext-v*`, `skill-v*`) only ever bumps within the one you
  pinned.
- **Branch** — literally `main` or `master`; the `sha` bumps to that branch's
  HEAD. For a repo publishing no usable tags.

A `ref` of any other value (`1.2.0`, `release-2026`, a bare SHA) matches neither
manager, and that entry is then silently never updated again.

## Check upstream Codex parity

After resolving the pinned SHA in either mode, inspect the **whole upstream repo**,
not only the Claude catalog path. Search its tree for native Codex surfaces such as
root `plugin.json`, `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`,
`.agents/skills/`, `.codex/hooks.json`, skill-adjacent `agents/*.toml`, and OpenAI
plugin build/test files.

For every discovered Claude artifact:

1. A normal Agent Skill is native unless upstream ships a Codex-specific variant;
   prefer that variant when it exists.
2. Compare commands, agents, hooks and MCP configuration with candidate Codex
   files by behavior, not filename. A native manifest that omits a Claude agent is
   evidence of a gap, not an equivalent.
3. When upstream owns an equivalent, record the Codex artifact as `adapted` in
   `scripts/distribution-meta.json`, with repo-relative `sourcePath` and a test or
   executable proof in `evidencePath`. The generator verifies both paths at the
   pinned SHA. Prefer this upstream implementation over generating a translation.
4. When no equivalent exists, keep the explicit generated adaptation or
   unsupported limitation and fallback. Never infer parity from a manifest alone.

Check runtime closure, not just file presence: a skill calling a plugin-root
launcher needs its scripts, shared data, dependencies, and harness-specific path
resolution. The inventory and generated-skill validators reject unresolved
`CLAUDE_PLUGIN_ROOT` references. Use a proven upstream adaptation where available;
otherwise record the exact unsupported limitation and fallback. When an entire
entry requires an unavailable runtime, `unsupportedEntries` in
`scripts/distribution-meta.json` supplies both harness outcomes; artifact-specific
records take precedence.

Run `node scripts/gen-distribution.js --verify`. Done means every artifact has one
Codex and pi disposition, every recorded upstream equivalent exists at the pinned
SHA, and unsupported runtime closures are not advertised as portable. This is a
catalog change: leave package and parity-document generation to CI's `regenerate`
workflow, as specified by CLAUDE.md.

## Add mode

1. Parse args. If `owner/repo` missing, ask for it.
2. Decide granularity. `path` points at a plugin root (has
   `.claude-plugin/plugin.json`) holding artifacts a per-skill entry would drop
   — further skills, subagents, or commands → one **whole-plugin** entry at that
   root — or, when the plugin root is the repo root, a **url entry**
   (`"source": "url"`, `url`, `ref`, `sha`, no `path`; git-subdir `"."`
   installs empty, ADR-0033); skip per-skill discovery,
   take `name` from the `plugin.json`. Otherwise discover skills: `path` = a skill folder →
   single entry; a parent folder → only folders under it (empty → stop,
   report); omitted → all (batch).
3. Pick the `ref` (see above), then fetch the SHA it resolves to — one SHA
   shared by every entry from that repo. Confirm the skill's `path` exists at
   that SHA.
4. `name` = arg (single) or folder basename (batch). Confirm **every** name is
   free in `marketplace.json` — report collisions and ask before proceeding.
5. For each skill, fetch its upstream `description` one-liner and author. Append
   each entry to the `plugins` array (match existing formatting exactly):
   ```json
   {
     "name": "<name>",
     "source": {
       "source": "git-subdir",
       "url": "https://github.com/<owner>/<repo>",
       "path": "<path>",
       "ref": "<tag or branch>",
       "sha": "<sha>"
     },
     "description": "<one line saying what the skill does>",
     "author": {
       "name": "<upstream author>",
       "url": "<upstream author or repo URL>"
     }
   }
   ```
   The `description` says what the skill does in one line: a summary of
   upstream's description (its first sentence when that already reads well),
   or of the `SKILL.md` body when upstream's is empty or unusable. Drop the
   "Use when…" trigger clauses: they steer the harness, not the catalog reader.
   For a **whole-plugin** entry, list its bundled artifacts (agents +
   skills), e.g. `"…: bash-pro and posix-shell-pro agents plus the
   bash-defensive-patterns, bats-testing-patterns, and shellcheck-configuration
   skills."`.
6. Validate the catalog with `claude plugin validate .` first, resolving reserved
   names with a descriptive alias. **Regenerate the README** (see below), then run
   the remaining checks.

Done when every skill the discovery in step 2 turned up is either an entry in
`marketplace.json` or named as deliberately left out, and the repo has a row in
ADR-0014's source table — **whole** or **curated**, asked, never guessed. A
skill left out of a whole source goes in its exclusions table, with the reason.

## Update mode

For each external source repo (git-subdir or url entry) in `marketplace.json` (or the one named):

1. Discover the repo's current skill folders, and its latest tag or branch HEAD
   to match how its entries are pinned.
2. Reconcile against the existing entries:
   - **New** upstream folder (no entry) → look the repo up in
     `docs/adr/0014-each-source-repo-is-whole-or-curated.md`. Skip a **catalog
     exclusion** and a harness mirror or fixture silently. On a **whole source**,
     add an entry (as in add mode). On a **curated source**, list it and **ask**;
     one declined goes in the exclusions table so it is not asked again. A repo
     with no row → ask which kind it is and add the row.
   - **Removed** upstream (a git-subdir entry whose `path` no longer has
     `SKILL.md`, or a url entry whose repo is gone) → list
     it, **ask to confirm**, then delete the entry (see **Removing an entry**).
     Left alone, regeneration prunes it anyway once Renovate moves its `sha`
     (ADR-0015); doing it here just gets there first.
   - **Branch-pinned repo that now tags** → when a `main`/`master` entry's repo
     publishes a tag of the shape *Pinning the `ref`* names (`vX.Y.Z`, optionally
     prefixed), re-pin every entry of that repo as tag-pinned; the next bullet
     moves it. When that tag does not descend from the pinned `sha`, ask first:
     the switch would downgrade or leave the pinned history.
   - Bump each surviving entry to the SHA its `ref` now resolves to: a
     tag-pinned entry moves `ref` and `sha` together to the latest tag, keeping
     its tag series; a branch-pinned entry takes that branch's HEAD. (Renovate
     also does this; harmless to set now.)
   - Refresh each entry's `author` from upstream, and its `description` only
     when upstream's meaning changed — a reworded upstream sentence is no reason
     to rewrite a summary. `marketplace.json` is the source of truth, so this is
     what consumers see.
     A rewrite is checked against the upstream artifact at the pinned `sha` —
     the `SKILL.md` body, or a whole plugin's manifest and artifact list —
     before it lands, not only against upstream's description.
     When a description is reviewed and kept, record the entry's pinned `sha`
     under its name in `descriptionReviewed` in `scripts/catalog-meta.json`; a
     rewrite needs no record.
3. **Regenerate the README**, then validate.

Done when every external source repo in scope is accounted for — reconciled, or
reported as already current. A repo silently skipped is one Renovate keeps
bumping while its entry list drifts.

## Removing an entry

Whatever the reason — gone upstream, or dropped by decision — deleting an entry
also means:

- Drop its name from every bundle's `dependencies` that lists it, and bump that
  bundle's `version`.
- Tell the user that **installed copies break**: `claude plugin update` on a name
  no longer in the catalog fails with `Plugin "<name>" not found`. List where it is
  installed (`claude plugin list --json`, filter on `@filippo-skills`) and offer
  `claude plugin uninstall <name>@filippo-skills -s <scope>` for each — a
  `project` scope runs from that project's directory and edits its committed
  `.claude/settings.json`, so ask before touching it. The README's *When a skill
  leaves the catalog* gives other users the same steps; name the removed skills
  in the PR body so they know what to uninstall.

## Regenerate the README

The README **Available skills** catalog is a **projection** of
`marketplace.json` produced by `scripts/gen-readme.js` — never hand-edit it.

- If you referenced a skill from a **new** source repo, add a group to
  `scripts/catalog-meta.json` (ordered list):
  ```json
  { "repo": "<owner>/<repo>", "tagline": "<short label>", "kind": "skill" }
  ```
  Use `"kind": "plugin"` for a whole-plugin entry (renders a "What it bundles"
  column). The generator **throws** if any external entry's repo has no group
  (or is not omitted), so this can't be silently
  missed.
- Run the generator:
  ```bash
  node scripts/gen-readme.js
  ```

## Finish

```bash
bash scripts/validate.sh --catalog-only
```
Generated `skills/`, Codex packages, pi filters, and the parity matrix intentionally
remain stale until the post-merge regeneration workflow; `--catalog-only` skips
their checks. Report what changed (added / removed /
description updates), unsupported harness outcomes, and checks actually run.
Do not commit — leave that to the user.
