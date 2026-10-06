#!/usr/bin/env bash
set -Eeuo pipefail

for command_name in codex jq; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
done

repo="$(git rev-parse --show-toplevel)"
codex_home="$(mktemp -d "$repo/.codex-marketplace-test.XXXXXX")"
cleanup() { rm -rf "$codex_home"; }
trap cleanup EXIT
export CODEX_HOME="$codex_home"

codex plugin marketplace add "$repo" --json |
  jq -e '.marketplaceName == "filippo-skills"' >/dev/null

codex plugin list --marketplace filippo-skills --available --json |
  jq -e '.available[] | select(.pluginId == "tdd@filippo-skills")' >/dev/null

for plugin in tdd api-scaffolding matt-pocock-bundle impeccable diagram-design; do
  plugin_id="$plugin@filippo-skills"
  codex plugin add "$plugin_id" --json |
    jq -e --arg plugin_id "$plugin_id" '.pluginId == $plugin_id' >/dev/null
done

codex plugin list --marketplace filippo-skills --json |
  jq -e '[.installed[] | select(.installed and .enabled)] | length == 5' >/dev/null

printf 'Codex marketplace smoke passed: plain, converted-agent, bundle, hook, and upstream-adapted packages install.\n'
