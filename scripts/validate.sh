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
# --projection-diff snapshots the same way, regenerates every projection there and counts the
# changed files per catalog entry against HEAD (uncommitted projection edits count too),
# leaving this checkout untouched; it runs no check.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-}"
generators=(gen-skills-tree gen-readme gen-distribution gen-pi gen-codex)
if [ "$#" -gt 1 ] || [[ "$mode" != '' && "$mode" != --catalog-only && "$mode" != --isolated && "$mode" != --projection-diff ]]; then
  echo 'Usage: bash scripts/validate.sh [--catalog-only|--isolated|--projection-diff]' >&2
  exit 2
fi

if [ "$mode" = --isolated ] || [ "$mode" = --projection-diff ]; then
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

if [ "$mode" = --projection-diff ]; then
  for gen in "${generators[@]}"; do node "scripts/$gen.js" > /dev/null; done
  echo '=== projection changes against HEAD (files per catalog entry)'
  # A vendored skill names its entry in SOURCE.md; a removed one falls back to its folder.
  git status --porcelain -z --no-renames -uall -- skills .agents docs/distribution-parity.md README.md \
    | while IFS= read -r -d '' line; do
        file="${line:3}"
        case "$file" in
          skills/*/*)
            dir="${file#skills/}"; dir="${dir%%/*}"
            entry="$(sed -n 's/.*\*\*Catalog entry\*\*: `\([^`]*\)`.*/\1/p' "skills/$dir/SOURCE.md" 2> /dev/null || true)"
            echo "entry ${entry:-$dir}" ;;
          .agents/plugins/packages/*/*)
            pkg="${file#.agents/plugins/packages/}"; echo "entry ${pkg%%/*}" ;;
          *) echo "$file" ;;
        esac
      done | sort | uniq -c
  exit 0
fi

run() {
  echo "=== $*"
  "$@"
}

run bash scripts/run-tests.sh                        # every test; CI runs this same script
run node scripts/gen-readme.js --check               # README's generated regions match the catalog; local descriptions ≤ 500 chars; no artifact count on a branch pin
run node scripts/gen-skills-tree.js --verify-paths   # classify artifacts and build in temp, including overlays
run node scripts/check-renovate.js                   # Renovate regexes cover every external entry; no orphan packageRules
run node scripts/check-sha-history.js origin/main    # no pinned sha moved behind, diverged or onto another history
run node scripts/check-whole-sources.js --classified # every external repo is whole or curated in ADR-0014, every curated one has a curation baseline
run node scripts/check-name-collisions.js            # what claude plugin validate does NOT cover
# Its `❯` lines report what each hooks module hooks and calls, not warnings: a
# "gating hook with/without .catch" line is a fact (plugin-authoring reference).
# A finding fails the run, as with every other check here.
run claude plugin validate --strict .                # marketplace + all local plugins
run actionlint                                       # workflow syntax and the shell in run: steps

if [ "$mode" = --catalog-only ]; then
  echo '=== projection checks skipped (--catalog-only): regeneration refreshes them after merge'
  echo '=== validate.sh: every check passed'
  exit 0
fi
if [ "$mode" = --isolated ]; then
  for gen in "${generators[@]}"; do run node "scripts/$gen.js"; done
  run node scripts/gen-skills-tree.js --check
fi
run node scripts/gen-distribution.js --check         # parity matrix matches the inventory
run node scripts/gen-pi.js --check                   # pi bundle filters match runtime closures
run node scripts/gen-codex.js --check                # native Codex packages match the inventory
run bash scripts/test-pi-package.sh                  # pi 1.0.4 package/filter smoke
# Codex 0.160.1 lifecycle/hook smoke; 75 is its clone timeout on a slow link (#438).
echo '=== bash scripts/test-codex-marketplace.sh'
codex_smoke=0
bash scripts/test-codex-marketplace.sh || codex_smoke=$?
if [ "$codex_smoke" -eq 75 ]; then
  echo '=== validate.sh: every check passed except the network-bound Codex upgrade (#438); CI runs it'
  exit 75
fi
[ "$codex_smoke" -eq 0 ] || exit "$codex_smoke"
echo '=== validate.sh: every check passed'
