#!/usr/bin/env bash
# Every node test in the repo. One place, because two workflows run it —
# `validate` on each pull request, `regenerate` before it proposes a tree — and a
# copy in each drifted: one carried the empty-glob guard below, the other passed
# silently on nothing.
#
# Globs, not a list: a new test is picked up by adding the file, with no second
# edit anywhere. Grouped, not one array, so an entire group vanishing is still
# caught — the guard is the point.
set -euo pipefail
shopt -s nullglob

run_group() {
  local label=$1
  shift
  local tests=("$@")
  if [ ${#tests[@]} -eq 0 ]; then
    echo "no $label found: the glob matched nothing, which is never right here" >&2
    exit 1
  fi
  for t in "${tests[@]}"; do
    echo "--- $t"
    node "$t"
  done
}

run_group 'repo script tests' scripts/*.test.js
run_group 'local plugin hook tests' plugins/*/hooks/*.test.js
