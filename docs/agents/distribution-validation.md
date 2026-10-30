# Delegating and validating distribution changes

## Acceptance matrix

When delegating work on discovery, projection, runtime closure or update preflight,
give each worker the relevant cases before implementation:

| Entry shape | What the acceptance cases must account for |
| --- | --- |
| Single skill | Skill metadata, support files and declared runtime dependencies |
| Whole plugin in a subdirectory | Nested skills and other artifacts, even when the plugin manifest survives |
| Repo-root URL plugin | The same artifact/loss checks without relying on a non-root `path` |

Each case ends in a passing test, or an explicit reason it does not apply. Ask
workers to report the test commands they ran and any untested cases. Reviewer
agents check those claims against the originating requirements, not just the diff.

## Validation order

After collecting worker changes, run `bash scripts/run-tests.sh` before any
manual regeneration. This includes existing callers' fixtures, not only the tests
owned by each worker. Stop on failure before paying for upstream or harness checks.

For full validation, use `bash scripts/validate.sh --isolated`. It snapshots HEAD
plus staged, unstaged and non-ignored untracked changes into a disposable detached
worktree. It runs the offline suite first, validates the catalog, then regenerates
and checks projections and runs pi/Codex smokes there. Ignored local files are not
copied. Untracked nested repositories are rejected rather than recursively copied;
ignore or move them before validating. The original checkout and index stay
untouched; the temporary worktree is removed on success or failure. Keep the source checkout unchanged while it snapshots.

`bash scripts/validate.sh --catalog-only` remains the lighter in-place catalog
check. Of the generated outputs, only the README's regions belong in the feature
commit (`node scripts/gen-readme.js`), since pull-request CI checks them; leave
every other projection to the post-merge regeneration workflow.

A change confined to one local plugin, catalog and projections untouched (a hook
fix, a mod's code and tests, a version bump), needs only `bash scripts/run-tests.sh`
and `claude plugin validate .` while iterating; run `--isolated` once, before the PR.
