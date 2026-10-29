#!/usr/bin/env bash
# The whole pre-commit validation, in one place. No workflow runs this script:
# `validate` (pull requests) and `regenerate` each run their own subset, and
# together they cover this list. Stops at the first failure.
#
# The projection `--check`s and the smoke tests of the generated packages run
# last: after a catalog-only change (a sha bump) the committed projections are
# stale by design until regeneration, so `--catalog-only` skips them and every
# other check still runs. --isolated snapshots the current work (including untracked
# non-ignored files), tests it first, then materializes projections in a disposable worktree.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-}"
if [ "$#" -gt 1 ] || [[ "$mode" != '' && "$mode" != --catalog-only && "$mode" != --isolated ]]; then
  echo 'Usage: bash scripts/validate.sh [--catalog-only|--isolated]' >&2
  exit 2
fi

if [ "$mode" = --isolated ]; then
  repo="$PWD"
  scratch="$(mktemp -d "${TMPDIR:-/tmp}/skills-validate.XXXXXX")"
  worktree="$scratch/tree"
  cleanup() {
    if [ -f "$worktree/.git" ]; then git -C "$repo" worktree remove --force "$worktree"; fi
    rm -rf "$scratch"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  git worktree add --quiet --detach "$worktree" HEAD
  git diff --binary --no-ext-diff --no-textconv HEAD > "$scratch/work.patch"
  if [ -s "$scratch/work.patch" ]; then git -C "$worktree" apply --binary "$scratch/work.patch"; fi
  git ls-files --others --exclude-standard -z > "$scratch/untracked"
  while IFS= read -r -d '' file; do
    # Git collapses nested repositories to directories; tar would include their ignored files.
    if [ -d "$file" ] && [ ! -L "$file" ]; then
      printf 'Cannot snapshot untracked directory %s; ignore or move the nested repository first.\n' "$file" >&2
      exit 1
    fi
  done < "$scratch/untracked"
  tar -cf "$scratch/untracked.tar" --null -T "$scratch/untracked"
  tar -xf "$scratch/untracked.tar" -C "$worktree"
  cd "$worktree"
fi

run() {
  echo "=== $*"
  "$@"
}

run bash scripts/run-tests.sh                        # every test; CI runs this same script
run node scripts/gen-readme.js --check               # README's generated regions match the catalog
run node scripts/gen-skills-tree.js --verify-paths   # classify artifacts and build in temp, including overlays
run node scripts/check-renovate.js                   # Renovate regexes cover every external entry
run node scripts/check-name-collisions.js            # what claude plugin validate does NOT cover
run claude plugin validate .                         # marketplace + all local plugins

if [ "$mode" = --catalog-only ]; then
  echo '=== projection checks skipped (--catalog-only): regeneration refreshes them after merge'
  exit 0
fi
if [ "$mode" = --isolated ]; then
  run node scripts/gen-skills-tree.js
  run node scripts/gen-readme.js
  run node scripts/gen-distribution.js
  run node scripts/gen-pi.js
  run node scripts/gen-codex.js
  run node scripts/gen-skills-tree.js --check
fi
run node scripts/gen-distribution.js --check         # parity matrix matches the inventory
run node scripts/gen-pi.js --check                   # pi bundle filters match runtime closures
run node scripts/gen-codex.js --check                # native Codex packages match the inventory
run bash scripts/test-pi-package.sh                  # pi 1.0.4 package/filter smoke
run bash scripts/test-codex-marketplace.sh           # Codex 0.160.1 lifecycle/hook smoke
