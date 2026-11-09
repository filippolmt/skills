#!/usr/bin/env bash
# Fills the impeccable launcher's version-pinned cache before the Codex hook smoke.
# The launcher's own download retries twice and discards curl's stderr: a transient
# GitHub Releases error failed the smoke with no cause in the log. Here the download
# retries, shows its errors, and is checked against engine-checksums.txt before it
# enters the cache. Cache path, manifest format and URL mirror the launcher's; the
# closing probe fails when the launcher stops finding this copy.
set -Eeuo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
dir="$repo/.agents/plugins/packages/impeccable/skills/impeccable/scripts"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{ print $1 }'
}

version="$(tr -d '[:space:]' < "$dir/VERSION")"
case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) printf 'unsupported OS for the impeccable engine: %s\n' "$(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) printf 'unsupported arch for the impeccable engine: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac
asset="impeccable-$os-$arch"
sum="$(awk -v v="$version" -v a="$asset" '$1 == v && $2 == a { print $3 }' "$dir/engine-checksums.txt")"
if [[ -z $sum ]]; then
  printf 'no checksum for %s %s in %s\n' "$version" "$asset" "$dir/engine-checksums.txt" >&2
  exit 1
fi

dest="${IMPECCABLE_HOME:-$HOME/.impeccable}/bin/$version/impeccable"
if [[ ! -x $dest || "$(sha256_of "$dest")" != "$sum" ]]; then
  mkdir -p "${dest%/*}"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 -o "$dest.part" \
    "https://github.com/pbakaus/impeccable/releases/download/engine-v$version/$asset"
  if [[ "$(sha256_of "$dest.part")" != "$sum" ]]; then
    rm -f "$dest.part"
    printf 'checksum mismatch for impeccable engine %s %s\n' "$version" "$asset" >&2
    exit 1
  fi
  chmod +x "$dest.part"
  mv -f "$dest.part" "$dest"
fi

# An unreachable download base: the launcher must answer from the cache.
IMPECCABLE_DOWNLOAD_BASE=http://127.0.0.1:9 "$dir/impeccable" engine-probe >/dev/null
