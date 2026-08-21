---
status: accepted
---

# The command that writes the note is `/carryover`, not `/handoff`

`0.8.0` moved the handoff note's schema out of the hook and into a typed command,
`/handoff` (`0002-handoff-note-as-typed-command.md`). The name was already taken:
this marketplace also ships `handoff`, an unrelated skill from `mattpocock/skills`
that writes a different document to a different place. `0.9.0` renames the command
to `/carryover`.

## The collision was not a tie the router got to break

`route.js` shipped a special-case matcher for its own name — deliberately *not*
the last-segment rule the modes use — on the reasoning that a bare `/handoff`
"counts as this plugin's (the ambiguity is irreducible there, and the router is the
half that needs the turn)". That was the one contract in this plugin nobody had
measured, in a design where every other harness contract was verified empirically
and labelled as such.

Measured, it is not ambiguous. It is deterministically wrong:

```
$ claude -p "/handoff" --output-format stream-json --verbose
  "slash_commands":[…,"handoff:handoff",…]      # no bare /handoff exposed at all
  …reads plugins/cache/filippo-skills/handoff/…/SKILL.md
  "Write a handoff document summarising the current conversation…"
```

The harness exposes no bare `/handoff`; typing it expands the **other** plugin's
skill body. The hook, meanwhile, reads the **raw prompt text** — `slashCommand()`
splits the string the user typed, it never sees which command the harness resolved
— so it matched its own name and did what a `/handoff` turn asks for: suppress
routing, emit the note's resolved path, emit the recorded skill list.

The defect was **latent, not firing**: the upstream `handoff` skill is enabled in
the author's config, `mode-router` is not, and the contradiction needs both halves
loaded. That is a fact about one machine on one day, not a mitigation — it would
have fired on the first turn after enabling the plugin, which is precisely when
nobody would be looking for it.

So the turn held both halves of a contradiction, every time:

| Injected by the hook | Expanded as the body |
|---|---|
| write to `<cwd>/.mode-router/handoff.md` | write to the OS temp dir |
| exactly four fixed sections, ~30 lines | free prose, plus "suggested skills" |
| overwrite: one pending note at a time | no such rule |

`claude plugin validate .` passes clean on this repo, before and after. It checks
name uniqueness *within* the catalog; a command in one plugin against a skill in
another is outside what it looks at. Nothing would ever have flagged this.

## Why rename ours rather than drop theirs

Removing the `handoff` catalog entry would also have ended the collision, without
touching the router. Rejected: the upstream skill covers a case the note does not —
handing work to a different agent, or to a session outside a git project, where
writing `.mode-router/` makes no sense — and it ships an `agents/openai.yaml` for
exactly that portability. Deleting a working skill from the catalog to protect a
name we had no claim on is the wrong half to give way.

The rename is also the right fix on its own terms, collision aside. `CONTEXT.md`
defines **handoff note** as the artifact, and the artifact is what deserves the
domain word. One name covering the artifact, the act of producing it, and a third
party's unrelated document is a name doing three jobs.

## What the rename did *not* change

The strict `bare-or-own-namespace` matcher stays. Its stated reason was the
collision, but that was never the real one: `leaf()` would capture `X:carryover`
for any `X`, suppressing routing on a turn this plugin has no part in and injecting
a list aimed at a note somebody else's command does not write. That argument holds
however unique the name is today, so the matcher is correct by construction rather
than by the name staying free. What the rename removed is the unmeasured bet the
old name smuggled *into* it: `handoff` was a name another plugin answered to.

## Then the new name was measured too

A first draft of this ADR closed with a section admitting that nobody had checked
whether the harness exposes a bare `/carryover` either, and guessing at what would
happen if it did not. That is the same move this document was written to condemn, so
it was measured instead — `--plugin-dir` loads a local plugin for one session, which
makes the measurement possible without installing anything:

```
$ claude -p ping --plugin-dir …/plugins/mode-router \
      --plugin-dir …/caveman --plugin-dir …/ponytail \
      --output-format stream-json --verbose
  plugin_errors: none
  slash_commands: […,"mode-router:carryover","caveman:caveman",…]   # namespaced only

$ claude -p "/carryover" …
  "Unknown command: /carryover"     # no turn, no hook, no note

$ # with isCarryoverCommand patched to exclude nothing, so the arriving form is recorded:
$ claude -p "/mode-router:carryover" …
  session-<id>.skills.json: {"skills":[{"name":"mode-router:carryover","source":"typed"}]}
```

Three facts, and together they close the question:

1. Plugin commands are exposed **namespaced only** — there is no bare `/carryover`.
2. A bare one typed anyway dies as `Unknown command` **before** `UserPromptSubmit`,
   so the hook never sees it. The failure the draft imagined — the note's path
   arriving without the schema — cannot happen.
3. `UserPromptExpansion` delivers `command_name` **namespaced**.

So the bare form cannot arrive by any path, and `isCarryoverCommand` no longer
accepts it. Through `0.8.0` it did, on the reasoning that the bare name "might as
well" be claimed since it was ambiguous anyway; accepting a form that cannot arrive
is the same error as claiming one that belongs to somebody else — both assert
something about dispatch instead of measuring it. What the matcher requires now is
the one thing measured to arrive: `mode-router:carryover`, exactly.

Two smaller things the measurement turned up, recorded because both cost time:

- The plugin declares `dependencies: ["caveman", "ponytail"]`, and an unsatisfied
  dependency makes the whole plugin fail to load (`plugin_errors:
  dependency-unsatisfied`) — silently, as far as routing is concerned. Loading it
  for a measurement means loading all three.
- `--plugin-dir` takes a plugin's **name from the directory basename**, so the
  marketplace cache's hashed directory names load as plugins named after the hash,
  and dependency resolution fails. Symlinking the cache dirs under their real names
  is what makes it work.

The note keeps every property `0002` gave it, its filename included:
`.mode-router/handoff.md`, four sections, presence as status, the two-level 24h
expiry. Only the command moved.

## Consequences

- A command file's invocation name comes from its **filename** (no `name`
  frontmatter for commands), so `git mv commands/handoff.md commands/carryover.md`
  *is* the rename, and `CARRYOVER_COMMAND` has to follow it. The plugin-command
  case is undocumented upstream; the classic-command case (filename) is documented,
  and the filename is what this relies on.
- No deprecation alias. `/handoff` never reached this plugin in the first place —
  aliasing it would re-create the exact collision this removes — and the plugin has
  one user, who is the person making this change.
- The regression is pinned in `route.test.js`: a bare `/handoff` is now classified
  like any other foreign command and recorded as an ordinary skill, and
  `X:carryover` stays foreign too.
- `CONTEXT.md` gains **Carryover command** as a term distinct from **Handoff
  note**, and the note's entry no longer names the command that writes it — a
  glossary is not the place for that.
- The collision **class** is closed too, not just this instance.
  `scripts/check-name-collisions.js` compares every local command and skill name
  against each other and against every catalog entry, and runs in CI and in the
  `PostToolUse` hook — which now also fires on `commands/*.md`, the file type whose
  creation caused this. Its first test case is this defect's exact shape, because a
  checker that only ever agrees with the current tree guards nothing.
- Only **local** names are checked. What an upstream `git-subdir` entry contains is
  not knowable without fetching it, so the comparison uses its catalog `name` —
  which is what this collision was against anyway. An upstream plugin that adds a
  skill colliding with a local command is still found by noticing.
