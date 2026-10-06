#!/usr/bin/env bash
set -Eeuo pipefail

for command_name in pi jq node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
done

repo="$(git rev-parse --show-toplevel)"
test_home="$(mktemp -d "$repo/.pi-package-test.XXXXXX")"
cleanup() { rm -rf "$test_home"; }
trap cleanup EXIT
export PI_CODING_AGENT_DIR="$test_home/config"
export PI_PACKAGE_DIR="$test_home/packages"
export PI_OFFLINE=1
export PI_SKIP_VERSION_CHECK=1

commands() {
  (cd "$test_home" && printf '%s\n' '{"id":"commands","type":"get_commands"}' |
    pi --mode rpc --no-session --no-tools --no-context-files --offline 2>/dev/null) |
    jq -c 'select(.id == "commands" and .success).data.commands'
}

pi install "$repo" >/dev/null
all_commands="$(commands)"
for skill in tdd settings-validator api-scaffolding-backend-architect; do
  jq -e --arg name "skill:$skill" '.[] | select(.name == $name and .source == "skill" and .sourceInfo.origin == "package")' <<<"$all_commands" >/dev/null
done

node - "$repo" "$PI_CODING_AGENT_DIR/settings.json" <<'NODE'
const fs = require('fs');
const [repo, output] = process.argv.slice(2);
const markdown = fs.readFileSync(`${repo}/docs/pi-package-filters.md`, 'utf8');
const match = markdown.match(/## `matt-pocock-bundle`\n\n```json\n([\s\S]*?)\n```/);
if (!match) throw new Error('generated matt-pocock-bundle filter not found');
const settings = JSON.parse(match[1]);
settings.packages[0].source = repo;
fs.mkdirSync(require('path').dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(settings, null, 2)}\n`);
NODE

filtered_commands="$(commands)"
for skill in tdd code-review domain-modeling; do
  jq -e --arg name "skill:$skill" '.[] | select(.name == $name)' <<<"$filtered_commands" >/dev/null
done
if jq -e '.[] | select(.name == "skill:settings-validator")' <<<"$filtered_commands" >/dev/null; then
  printf 'bundle filter loaded an unrelated skill\n' >&2
  exit 1
fi

printf 'pi package smoke passed: native, local, converted, and bundle-filtered skills load.\n'
