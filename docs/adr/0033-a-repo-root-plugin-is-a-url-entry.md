---
status: accepted
---

# A plugin that is its whole repo is a url entry, not a git-subdir at `.`

ADR-0008 wrote a repo-root plugin as a git-subdir entry with `"path": "."`,
chosen because both Renovate regexes need a non-empty `path`. Nothing checked
what Claude Code installs from that shape. It installs almost nothing: Claude
Code 2.1.311 sparse-checks-out a git-subdir `path` in cone mode, and a cone at
the root brings only the top-level files. `seo-toolkit` and `diagram-design`
installed with no `skills/`, `agents/`, `hooks/` or `.claude-plugin/`, and
`claude plugin validate` passed both.

Reproduced with `claude plugin install` in an isolated `CLAUDE_CONFIG_DIR`, one
entry per throwaway marketplace, counting `SKILL.md` in the install cache:

| source | result |
|---|---|
| `git-subdir`, `path: "."` or `"./"` | top-level files only, 0 `SKILL.md` |
| `git-subdir`, `path: "skills"` | the subfolder, as expected |
| `url` (`url`, `ref`, `sha`) | the whole repo; `installed_plugins.json` records the pinned `sha` |
| `github` (`repo`, `ref`, `sha`) | same as `url` |

## Decision

- A plugin whose root is the repo root is a **url entry**:
  `{ "source": "url", "url": "https://github.com/<owner>/<repo>", "ref", "sha" }`,
  with no `path`. Same `url` form as a git-subdir entry, no `.git` suffix.
- `url` rather than `github`: it keeps the `url` field that `repoOf`, the
  Renovate regexes and every upstream script already read, so the only shape
  change is a missing `path`.
- Both Renovate regexes take `path` as optional. `check-renovate.js` counts
  every external entry (git-subdir or url) and fails on a git-subdir entry whose
  `path` is the repo root (`""`, `.`, `./`, `/`), naming the url shape as the fix,
  and on a url entry that carries a `path`: Claude Code ignores it and installs
  the whole repo (verified with the same probe), so the field only misleads.
- `catalog.js` owns the classification: `isExternal` (git-subdir or url),
  `isRepoRoot` (every spelling of the root) and `entryPath` (the root always
  spelled `.`, which a url entry always is), so the tree generator, whole-sources,
  branch-pin and description checks treat a url entry as a whole-plugin entry
  rooted at the repo root.

Supersedes ADR-0008's rule that a repo-root plugin is written `"path": "."`. The
rest of ADR-0008 stands.

## Considered options

- **Keep git-subdir and find a root spelling that works.** `.` and `./` both
  install empty; the cone has no spelling for "everything". Not available.
- **`github` source.** Works equally well at install time, but swaps `url` for
  `repo` and so changes every reader of the entry, Renovate included, for no gain.
- **Wait for Claude Code to treat `.` as the whole repo.** Leaves two plugins
  shipping empty for an unknown time, with nothing in our validation to notice.

## Consequences

- The guard is static: it catches the shape, not the install. Proving an
  install needs network and the `claude` CLI, which pull-request validation
  does not have; the probe that found this lives only in this ADR's table.
- Installs made before the fix keep their empty cache until
  `/plugin marketplace update filippo-skills` and a reinstall.
