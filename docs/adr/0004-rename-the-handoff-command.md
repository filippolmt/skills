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

## What is still unmeasured

One assumption survives, and naming it is the point of this section — the defect
above was born of an unmeasured claim stated as settled, so this ADR does not get
to close on another one.

**Nobody has verified that the harness exposes a bare `/carryover` at all.** The
plugin-command case is undocumented upstream, and it could not be measured from
here: `mode-router` is not among the author's enabled plugins, so `claude -p
"/carryover"` answers `Unknown command`. If the harness turns out to namespace
plugin commands the way it namespaces plugin skills — exposing only
`mode-router:carryover` — then a bare `/carryover` reaches `UserPromptSubmit` as
raw text the hook still recognises, while no command body expands: the note's path
and the skill list arrive without the four-section schema that tells the model what
to write. Quieter than the collision, and the same shape.

Two things bound it. It is not new — the old name had the identical exposure, and
worse, since something else answered — and the fix is known if it appears: type the
namespaced form, which is verified to work for plugin skills and is what
`ROUTING.md` documents as this command's canonical form. It is recorded here rather
than fixed because a fix for an unmeasured failure is speculative generality, and
because the measurement is one `claude -p` away for anyone who enables the plugin.

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
- The collision class is not closed, only this instance of it. Nothing in
  `claude plugin validate` or in CI compares the leaf names of local commands and
  skills against the catalog's entries, so the next one will be found the same way
  this one was: by noticing.
