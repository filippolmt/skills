#!/usr/bin/env bash
set -Eeuo pipefail

for command_name in codex jq node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
done

repo="$(git rev-parse --show-toplevel)"
local_home="$(mktemp -d "$repo/.codex-marketplace-test.XXXXXX")"
git_home="$(mktemp -d "$repo/.codex-marketplace-git-test.XXXXXX")"
cleanup() { rm -rf "$local_home" "$git_home"; }
trap cleanup EXIT

export CODEX_HOME="$local_home"
codex plugin marketplace add "$repo" --json |
  jq -e '.marketplaceName == "filippo-skills"' >/dev/null
codex plugin list --marketplace filippo-skills --available --json |
  jq -e '.available[] | select(.pluginId == "tdd@filippo-skills")' >/dev/null

for plugin in tdd api-scaffolding matt-pocock-bundle impeccable diagram-design; do
  plugin_id="$plugin@filippo-skills"
  codex plugin add "$plugin_id" --json |
    jq -e --arg plugin_id "$plugin_id" '.pluginId == $plugin_id' >/dev/null
done

installed="$(codex plugin list --marketplace filippo-skills --json)"
jq -e '[.installed[] | select(.installed and .enabled)] | length == 5' <<<"$installed" >/dev/null
jq -e '.installed[] | select(.pluginId == "tdd@filippo-skills")' <<<"$installed" >/dev/null
jq -e '.installed[] | select(.pluginId == "matt-pocock-bundle@filippo-skills")' <<<"$installed" >/dev/null
node "$repo/scripts/test-codex-hooks.mjs"

codex plugin remove tdd@filippo-skills --json |
  jq -e '.pluginId == "tdd@filippo-skills"' >/dev/null
if codex plugin list --marketplace filippo-skills --json |
  jq -e '.installed[] | select(.pluginId == "tdd@filippo-skills")' >/dev/null; then
  printf 'removed plugin is still installed\n' >&2
  exit 1
fi

export CODEX_HOME="$git_home"
codex plugin marketplace add filippolmt/skills --ref main --json |
  jq -e '.marketplaceName == "filippo-skills"' >/dev/null
codex plugin add tdd@filippo-skills --json |
  jq -e '.pluginId == "tdd@filippo-skills"' >/dev/null
codex plugin marketplace upgrade filippo-skills --json |
  jq -e '.selectedMarketplaces == ["filippo-skills"] and (.upgradedRoots | length == 1) and (.errors | length == 0)' >/dev/null
codex plugin list --marketplace filippo-skills --json |
  jq -e '.installed[] | select(.pluginId == "tdd@filippo-skills" and .installed and .enabled)' >/dev/null
codex plugin remove tdd@filippo-skills --json |
  jq -e '.pluginId == "tdd@filippo-skills"' >/dev/null

printf 'Codex marketplace lifecycle passed: install, coexistence, hooks, trust, upgrade, and removal.\n'
