#!/usr/bin/env bash
# The whole pre-commit validation, in one place: CI and regeneration enforce it
# jointly, so no single workflow runs the full list. The three projection
# `--check`s belong here, not in pull-request CI: a sha bump makes the committed
# projections stale by design (see CLAUDE.md, "Validate before committing").
# Stops at the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

run() {
  echo "=== $*"
  "$@"
}

run bash scripts/run-tests.sh                        # every test; CI runs this same script
run node scripts/gen-readme.js --check               # README's generated regions match the catalog
run node scripts/gen-skills-tree.js --verify-paths   # resolve paths and classify every Codex/pi artifact
run node scripts/gen-distribution.js --check         # parity matrix matches the inventory
run node scripts/gen-pi.js --check                   # pi bundle filters match runtime closures
run node scripts/gen-codex.js --check                # native Codex packages match the inventory
run bash scripts/test-pi-package.sh                  # pi 1.0.4 package/filter smoke
run bash scripts/test-codex-marketplace.sh           # Codex 0.160.1 lifecycle/hook smoke
run node scripts/check-renovate.js                   # Renovate regexes cover every git-subdir entry
run node scripts/check-name-collisions.js            # what claude plugin validate does NOT cover
run claude plugin validate .                         # marketplace + all local plugins
