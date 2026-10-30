#!/usr/bin/env bash
# Every test in the repo: node, the python tests of skill scripts, and mod tests
# under `claude plugin test` (so the Claude Code CLI must be installed). One
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

# A mod's tests run in the engine's own kit, which takes the plugin folder.
# shortcut: a mod with several test files runs its whole suite once per file; dedupe the folders if one appears.
mod_test() { claude plugin test "$(dirname "$(dirname "$1")")"; }
run_group mod_test 'mod tests' plugins/*/hooks/*.test.tsx
