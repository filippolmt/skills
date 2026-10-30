# Testing a mod

A mod (`GLOSSARY.md`, ADR-0034) runs inside Claude Code's engine, so its checks
differ from a hook script's.

## Tests

`claude plugin test plugins/<mod>` runs its `hooks/*.test.tsx`; `run-tests.sh`
runs it for every mod. Nothing sits beneath the plugin in a test: the test's own
`on(...)` answers every event and `$` call the mod reaches (`session.start`,
`agent.list`, `session.surfaces`, a `ui.render` beneath a band), or the call fails
with `no implementation for <event>`. `mock.clock` and `mock.store` answer those
nouns from memory; the test's `$` has no `store`, so assert what was recorded
through behaviour (a later work, a later drawing).

The loader refuses a module where `$` is passed to a function declared inside
`register`: declare such helpers at the module's top level.

## Typecheck

No stable copy of the `claude-code` types exists outside a session, so CI does
not typecheck mods. Loading the `plugin-authoring` skill writes this build's
types and names their path; typecheck with the `tsconfig.json` from that file's
header, kept in the scratchpad, its `include` naming that file and the mod's
`hooks` and `types`. Until the engine has loaded the mod from its own folder,
the editor's TypeScript diagnostics on mod files (`Cannot find module
'claude-code'`) are expected noise.

## Live checks

The agent cannot see what a mod draws. What it can see:

- `claude -p "<prompt>" --debug-file <path>` logs the module loading
  (`hooks module <mod>@<marketplace> loaded`), each hook settling, and each
  `$.store.set`. That run writes the real store.
- A drawing (a band, a pane) is the user's to check. Ask them to start the
  session with `--debug-file` under a gitignored repo folder, so the agent can
  read the log after.

Install from `filippo-skills` and restart Claude Code before a live check: after
`/plugin install` and `/reload-plugins` in a running session, `work-eta`'s band
did not show (cause unconfirmed). On the maintainer's work account a mod under
development cannot load (`disableSideloadFlags`), so live checks run after merge.
