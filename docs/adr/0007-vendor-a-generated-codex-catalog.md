---
status: proposed
---

# Serve Codex from a generated, vendored catalog on a release branch

This marketplace is built on one principle: external skills are **referenced**
upstream via `git-subdir`, never copied here. Serving Codex breaks it. Codex has a
plugin marketplace whose entry shape is nearly identical to ours — same
`source: "git-subdir"`, same `url` / `path` / `ref` | `sha`, same `source: "local"` —
so the catalog itself ports almost mechanically. What does not port is the target:

> Every plugin has a `.codex-plugin/plugin.json` manifest.

That holds even for a plugin shipping nothing but skills. Our 77 `git-subdir`
entries point at upstream folders holding a bare `SKILL.md`, or at most a
`.claude-plugin/plugin.json`. None has a `.codex-plugin/`, and we cannot add one to
somebody else's repository. A Codex marketplace entry pointing straight at those
paths resolves to a directory Codex will not accept as a plugin.

So there is no referencing route to Codex. Either we give up the `/plugins`
install UX and ship loose skill folders, or we **materialise** the plugins
ourselves. We materialise them: a generator builds a Codex plugin per portable
catalog entry — manifest plus the upstream skill copied at the pinned `sha` — and
CI publishes the result to a dedicated `codex` branch.

## What was decided

**Shape.** The Codex catalog is a **projection** of `.claude-plugin/marketplace.json`,
in the same sense the README's catalog table already is: derived, checked in CI,
never hand-edited. The irreducible editorial data Codex demands and our catalog
lacks — `interface.category` — goes in `scripts/catalog-meta.json`, which already
holds exactly that kind of data. `policy` is a constant in the generator.
`displayName`, `shortDescription`, `author.name` are derived from the entry and its
URL; `longDescription` comes from the upstream `SKILL.md` frontmatter, so it tracks
the upstream text instead of drifting from it. `version` is derived from the `ref`
when it is a SemVer tag (`v2.4.0` → `2.4.0`), otherwise `0.0.0+<short sha>` — the
version is not ours to invent.

**Adaptation is an overlay, not a fork.** Some skills need Codex-specific edits.
The vendored copy stays byte-identical to upstream and the edit lives beside it as a
unified diff applied with `git apply`. The point is the failure mode: when upstream
changes the lines a patch touches, `git apply` **fails**, and the job stops. Whole
replacement files would keep working while silently freezing a skill at a
months-old upstream — the same silent-drift class as the Renovate seam this repo
already documents.

**Subagents.** Codex does have custom subagents, but a plugin cannot ship them —
the plugin layout is `skills/`, `hooks/`, `.mcp.json`, `.app.json`, `assets/`, with
no `agents/` — and Codex "only spawns subagents when you explicitly ask it to",
where our fan-out skills spawn them mid-skill on their own. At least 16 catalog
entries ship an `agents/` directory. The rule: **a skill that spawns one subagent in
sequence gets it ported to a skill in the same plugin; a skill whose value is the
parallel fan-out is excluded.** By that rule `code-review` (two axes in parallel) and
`research` are out. The per-entry pass happens in a dedicated PR before the first
release, not incidentally.

**Hooks port further than expected.** Codex's hook events are our event names
(`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`,
`PreCompact`…), with the same `exit 2` + stderr and the same
`{"hookSpecificOutput": {"permissionDecision": "deny"}}`. The matchers line up too:
`Bash` is literally `Bash`, `apply_patch` aliases to `Edit|Write`, and `spawn_agent`
also matches as `Agent`. So `zsh-wordsplit-guard` and `mode-router` port.
`agent-report-guard` does not — not for want of a matcher, but because
`PreToolUse` coverage outside Bash is openly incomplete upstream
(openai/codex#16732, #20204) and because the guard reads `tool_input.name` to tell a
named spawn from an unnamed one, which is the shape of Claude's arguments, not
Codex's. Right matcher, wrong payload.

**Bundles are dropped.** A Codex manifest has no `dependencies` field, so a bundle
there is a plugin that installs nothing.

**Failures are loud.** An entry that will not resolve — repo gone, `path` moved,
`sha` force-pushed away — fails the whole generation. Skipping it would remove a
skill from the Codex catalog with nobody noticing, and keeping the last good copy is
worse still: sometimes an upstream disappears for a reason.

## Considered and rejected

- **Wrapper plugins** — a local Codex plugin per entry carrying only the manifest.
  `"skills": "./skills/"` is a path inside the plugin, so the wrapper would ship
  nothing.
- **Skills-only distribution** (`.agents/skills/`, installer script) — works, and is
  the only route for agents without a marketplace, but throws away the `/plugins`
  UX that motivated the whole exercise.
- **Upstream PRs** adding `.codex-plugin/plugin.json` to 77 repositories.
- **`pi`** as a second target. It has no marketplace at all — it scans
  `~/.agents/skills/`, `.agents/skills/`, `.pi/skills/` — so it would need a second
  distribution mechanism with a second meaning of "installed". Out of scope.
- **A separate repository** for the generated tree. It doubles the Renovate seam:
  the `sha` bump lands here and the artifact lives there.
- **The generated tree on `main`.** Rejected not for size but for reviewability:
  every Renovate PR would bury its one real line — the `sha` — under thousands of
  regenerated files, and those PRs are the mechanism the entire catalog's freshness
  rests on.

## Consequences

- **We redistribute other people's code.** Today we reference; from here their
  source is in our history, permanently. The generator reads each upstream licence,
  copies it next to the skill with a `SOURCE.md` recording repo, `sha` and licence,
  and **excludes repositories with no licence at all** — no licence means no right to
  redistribute. This is the least reversible part of the decision, which is why the
  first release is a five-skill pilot over bare `SKILL.md` entries with no overlays:
  the `.codex-plugin/` layout, the required `interface` fields and the `--sparse`
  flag are all taken from documentation, not from a successful install.
- **The `codex` branch is a release artifact, not a development one.** Renovate's
  PRs target `main`; regeneration runs on merge. The Codex catalog is therefore
  behind `main` by the lifetime of any open PR, by design.
- **The Renovate seam needs an explicit hole.** The generated catalog carries the
  same entry shape the two `customManager` regexes look for. It lives on another
  branch, which probably keeps it out of scope — and "probably" is the word this
  repo's own notes say not to accept here. `renovate.json` gets an `ignorePaths` for
  `.agents/plugins/**`, and `check-renovate.js` gains a case asserting the generated
  catalog is *not* covered.
- **The name-collision class reopens.** Plugin names map one-to-one from the
  catalog, but porting a subagent creates a *new* skill name, and `grill-me`,
  `handoff` and `teach` are already catalog entries. Ported skills are prefixed with
  their plugin's name, and `check-name-collisions.js` extends to the generated
  catalog. This is the shape of `0004` exactly: two namespaces, one name.
- **CI grows, the local hook does not.** `gen-codex-catalog.js --check` and
  `validate_plugin.py` run in CI. They stay out of the `PostToolUse` hook: generation
  clones 77 repositories, and a hook that blocks an edit for a minute gets disabled
  within days.
- **The README keeps one catalog table**, with a column marking the entries Codex
  does not get, plus a line for
  `codex plugin marketplace add filippo/skills --ref codex --sparse .agents/plugins`.
