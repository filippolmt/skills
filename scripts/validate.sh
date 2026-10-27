#!/usr/bin/env bash
# The whole pre-commit validation, in one place. No workflow runs this script:
# `validate` (pull requests) and `regenerate` each run their own subset, and
# together they cover this list. Stops at the first failure.
#
# The projection `--check`s and the smoke tests of the generated packages run
# last: after a catalog-only change (a sha bump) the committed projections are
# stale by design until regeneration, so `--catalog-only` skips them and every
# other check still runs.
set -euo pipefail
cd "$(dirname "$0")/.."

run() {
  echo "=== $*"
  "$@"
}

run bash scripts/run-tests.sh                        # every test; CI runs this same script
run node scripts/gen-readme.js --check               # README's generated regions match the catalog
run node scripts/gen-skills-tree.js --verify-paths   # resolve paths and classify every Codex/pi artifact
run node scripts/check-renovate.js                   # Renovate regexes cover every git-subdir entry
run node scripts/check-name-collisions.js            # what claude plugin validate does NOT cover
run claude plugin validate .                         # marketplace + all local plugins

if [ "${1:-}" = --catalog-only ]; then
  echo '=== projection checks skipped (--catalog-only): regeneration refreshes them after merge'
  exit 0
fi
run node scripts/gen-distribution.js --check         # parity matrix matches the inventory
run node scripts/gen-pi.js --check                   # pi bundle filters match runtime closures
run node scripts/gen-codex.js --check                # native Codex packages match the inventory
run bash scripts/test-pi-package.sh                  # pi 1.0.4 package/filter smoke
run bash scripts/test-codex-marketplace.sh           # Codex 0.160.1 lifecycle/hook smoke
