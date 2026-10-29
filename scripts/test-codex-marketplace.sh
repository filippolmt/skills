#!/usr/bin/env bash
set -Eeuo pipefail

for command_name in codex jq node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
done

repo="$(git rev-parse --show-toplevel)"
# Codex refuses helper aliases beneath the OS temp directory, even for temp checkouts.
smoke_home="$(mktemp -d "$HOME/.codex-smoke.XXXXXX")"
cleanup() { rm -rf "$smoke_home"; }
trap cleanup EXIT
local_home="$smoke_home/local"
git_home="$smoke_home/git"
mkdir "$local_home" "$git_home"

codex() {
  local output status=0
  output="$(command codex "$@" 2>"$smoke_home/stderr")" || status=$?
  printf '%s\n' "$output"
  cat "$smoke_home/stderr" >&2
  if ! node "$repo/scripts/codex-smoke-warnings.js" "$smoke_home/stderr" <<<"$output"; then
    touch "$smoke_home/warning"
    printf '%s\n' "$output" >&2
    printf 'Codex smoke rejected warning output\n' >&2
    return 1
  fi
  return "$status"
}

export CODEX_HOME="$local_home"
codex plugin marketplace add "$repo" --json |
  jq -e '.marketplaceName == "filippo-skills"' >/dev/null
expected_plugins="$(jq -ce '[.plugins[].name] | if length > 0 then . else error("empty Codex marketplace") end' "$repo/.agents/plugins/marketplace.json")"
available="$(codex plugin list --marketplace filippo-skills --available --json)"
jq -e --argjson expected "$expected_plugins" '
  [.available[].pluginId] as $actual |
  all($expected[]; . + "@filippo-skills" | IN($actual[]))
' <<<"$available" >/dev/null

while IFS= read -r plugin; do
  plugin_id="$plugin@filippo-skills"
  codex plugin add "$plugin_id" --json |
    jq -e --arg plugin_id "$plugin_id" '.pluginId == $plugin_id' >/dev/null
done < <(jq -r '.[]' <<<"$expected_plugins")

installed="$(codex plugin list --marketplace filippo-skills --json)"
jq -e --argjson expected "$expected_plugins" '
  [.installed[] | select(.installed and .enabled) | .pluginId] as $actual |
  ($actual | length) == ($expected | length) and
  all($expected[]; . + "@filippo-skills" | IN($actual[]))
' <<<"$installed" >/dev/null
node "$repo/scripts/test-codex-hooks.mjs"

codex plugin remove tdd@filippo-skills --json |
  jq -e '.pluginId == "tdd@filippo-skills"' >/dev/null
remaining="$(codex plugin list --marketplace filippo-skills --json)"
if jq -e '.installed[] | select(.pluginId == "tdd@filippo-skills")' <<<"$remaining" >/dev/null; then
  printf 'removed plugin is still installed\n' >&2
  exit 1
fi

export CODEX_HOME="$git_home"
codex plugin marketplace add filippolmt/skills --ref main --json |
  jq -e '.marketplaceName == "filippo-skills"' >/dev/null
codex plugin add tdd@filippo-skills --json |
  jq -e '.pluginId == "tdd@filippo-skills"' >/dev/null
# Codex gives the upgrade's git clone a fixed 30s, which a slow link can miss (#438).
# Only that timeout is retried, after a pause; any other failure fails at once.
attempts=3
upgrade_err="$smoke_home/upgrade-stderr"
for attempt in $(seq "$attempts"); do
  if upgrade="$(codex plugin marketplace upgrade filippo-skills --json 2>"$upgrade_err")" &&
    jq -e '.selectedMarketplaces == ["filippo-skills"] and (.upgradedRoots | length == 1) and (.errors | length == 0)' >/dev/null <<<"$upgrade"; then
    cat "$upgrade_err" >&2
    break
  fi
  if [ -e "$smoke_home/warning" ] || [ "$attempt" -eq "$attempts" ] || ! grep -q 'timed out' - "$upgrade_err" <<<"$upgrade"; then
    printf '%s\n' "$upgrade" >&2
    cat "$upgrade_err" >&2
    printf 'marketplace upgrade failed (attempt %s/%s)\n' "$attempt" "$attempts" >&2
    exit 1
  fi
  printf 'marketplace upgrade timed out cloning, retrying (%s/%s)\n' "$attempt" "$attempts" >&2
  sleep 5
done
codex plugin list --marketplace filippo-skills --json |
  jq -e '.installed[] | select(.pluginId == "tdd@filippo-skills" and .installed and .enabled)' >/dev/null
codex plugin remove tdd@filippo-skills --json |
  jq -e '.pluginId == "tdd@filippo-skills"' >/dev/null

printf 'Codex marketplace lifecycle passed: all %s generated plugins install; coexistence, hooks, trust, upgrade, and removal passed.\n' "$(jq length <<<"$expected_plugins")"
