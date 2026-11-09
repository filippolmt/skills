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

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{ print $1 }'
}

# The hook smoke runs the impeccable launcher, whose own download retries twice and
# discards curl's stderr: a transient GitHub Releases error failed the smoke with no
# cause in the log. Fill the launcher's version-pinned cache here instead, with
# retries and visible errors. Cache path, manifest format and URL mirror the
# launcher's; the closing probe fails when the launcher stops finding this copy.
prefetch_impeccable_engine() {
  local dir="$repo/.agents/plugins/packages/impeccable/skills/impeccable/scripts"
  local version os arch asset sum dest
  version="$(tr -d '[:space:]' < "$dir/VERSION")"
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) printf 'unsupported OS for the impeccable engine: %s\n' "$(uname -s)" >&2; return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) printf 'unsupported arch for the impeccable engine: %s\n' "$(uname -m)" >&2; return 1 ;;
  esac
  asset="impeccable-$os-$arch"
  sum="$(awk -v v="$version" -v a="$asset" '$1 == v && $2 == a { print $3 }' "$dir/engine-checksums.txt")"
  if [[ -z $sum ]]; then
    printf 'no checksum for %s %s in %s\n' "$version" "$asset" "$dir/engine-checksums.txt" >&2
    return 1
  fi
  dest="${IMPECCABLE_HOME:-$HOME/.impeccable}/bin/$version/impeccable"
  if [[ ! -x $dest || "$(sha256_of "$dest")" != "$sum" ]]; then
    mkdir -p "${dest%/*}"
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 -o "$dest.part" \
      "https://github.com/pbakaus/impeccable/releases/download/engine-v$version/$asset"
    if [[ "$(sha256_of "$dest.part")" != "$sum" ]]; then
      rm -f "$dest.part"
      printf 'checksum mismatch for impeccable engine %s %s\n' "$version" "$asset" >&2
      return 1
    fi
    chmod +x "$dest.part"
    mv -f "$dest.part" "$dest"
  fi
  # An unreachable download base: the launcher must answer from the cache.
  IMPECCABLE_DOWNLOAD_BASE=http://127.0.0.1:9 "$dir/impeccable" engine-probe >/dev/null
}
prefetch_impeccable_engine

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
