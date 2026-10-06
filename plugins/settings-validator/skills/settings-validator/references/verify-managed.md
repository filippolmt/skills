# Verify deployed managed settings from the CLI

`/status` is interactive: you can't run it. Probe each changed key from the
shell instead, and leave the user only what no command shows.

## Probes

Each probe, with what it prints when the key applies:

- **Server-managed payload reached the machine**: new keys present, removed
  keys gone, file mtime after the change.
  `jq -r 'paths(scalars)|map(tostring)|join(".")' ~/.claude/remote-settings.json | grep <key>`
- **`autoMode.environment`**: the custom entries next to `$defaults`.
  `claude auto-mode config | jq -r '.environment[]'`
- **`disableSideloadFlags`**: exit 1, with an error naming the key.
  `claude --plugin-dir <empty dir> -p ok`
- **A marketplace is registered**: listed with its source.
  `claude plugin marketplace list`
- **A private marketplace can update unattended**: a commit, no prompt; run on
  each kind of machine.
  `GIT_TERMINAL_PROMPT=0 git ls-remote <url> HEAD`

For a key with no probe here, look for a CLI subcommand that prints its effect
(`claude --help`) before handing it to the user.

## Caveats

- **Stale first run.** The first CLI call after a console change can evaluate
  the old settings while it fetches the new ones in the background, even with
  `forceRemoteSettingsRefresh: true`. Make one throwaway call, or run each
  read-only probe twice. (*observed* once)
- **The cache path is not an interface.** `~/.claude/remote-settings.json` is
  an implementation detail seen on Claude Code 2.1.291: confirm the file exists
  before reading it. It holds only server-managed settings; for MDM or a
  `managed-settings.json` file, read the delivered file itself. (*observed*)

## Manual checks

Name these in the delivery, each with where the user looks:

- a marketplace's auto-update state: `/plugin` → Marketplaces, since
  `claude plugin marketplace list` does not show it
- machines you can't reach from this shell, such as macOS hosts whose SSH key
  has a passphrase: the `git ls-remote` probe, run there
