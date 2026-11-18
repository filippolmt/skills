# orca-agent-view

[Orca](https://github.com/stablyai/orca)'s Claude Code mod that opens a
subagent's view when you pick it in Orca's sidebar. Orca writes this plugin
itself and starts `claude` with `--plugin-dir` pointing at it; a managed policy
with `disableSideloadFlags` rejects that flag, so the sidebar navigation stops
working. This copy installs the same mod from this marketplace instead.

The files under `hooks/` are Orca's, unmodified, rebuilt from Orca's source by
`scripts/sync-orca-agent-view.js` (ADR-0046). Only `plugin.json`'s `version` and
`description` are ours. MIT licensed by Lovecast Inc.: see `LICENSE`.

## Setup

1. In Orca → Settings → Agents, turn **Claude subagent navigation** off, so Orca
   stops passing `--plugin-dir`.
2. Install: `/plugin install orca-agent-view@filippo-skills`.
3. Orca triggers the mod by sending one of `ctrl+alt+g`, `ctrl+alt+h` or
   `ctrl+alt+v` to the pane. With the option off Orca removes its own binding,
   so add this block to the `bindings` array of `~/.claude/keybindings.json`,
   preferably with a chord other than the one Orca used, which Orca may remove
   again:

   ```json
   { "context": "Chat", "bindings": { "ctrl+alt+h": "command:orca-agent-view" } }
   ```

The mod registers `/orca-agent-view` only in an interactive terminal session
inside an Orca pane (`ORCA_PANE_KEY` set); everywhere else it does nothing.

## Limits

- Orca ships almost daily; this copy follows within a day plus your
  `/plugin update`. If Orca changes the bridge protocol in between, navigation
  stops silently until the update arrives.
- The sync fails on purpose when Orca changes how it builds the plugin; the
  copy then stays at its last version until the script is updated.
