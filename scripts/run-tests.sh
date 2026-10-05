#!/usr/bin/env bash
# Every test in the repo: node, plus the python tests of skill scripts. One
# place, because two workflows run it — `validate` on each pull request,
# `regenerate` before it proposes a tree — and a copy in each drifted: one
# carried the empty-glob guard below, the other passed silently on nothing.
#
# Globs, not a list: a new test is picked up by adding the file, with no second
# edit anywhere. Grouped, not one array, so an entire group vanishing is still
# caught — the guard is the point.
set -euo pipefail
shopt -s nullglob

run_group() {
  local runner=$1 label=$2
  shift 2
  local tests=("$@")
  if [ ${#tests[@]} -eq 0 ]; then
    echo "no $label found: the glob matched nothing, which is never right here" >&2
    exit 1
  fi
  for t in "${tests[@]}"; do
    echo "--- $t"
    "$runner" "$t"
  done
}

run_group node 'repo script tests' scripts/*.test.js
run_group node 'local plugin hook tests' plugins/*/hooks/*.test.js
run_group python3 'local plugin script tests' plugins/*/skills/*/scripts/*_test.py
