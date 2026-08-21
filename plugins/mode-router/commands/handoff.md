---
description: Write the handoff note that carries this work across a deliberate /clear
disable-model-invocation: true
---

# Write the handoff note

The user is about to `/clear`. Write the note that carries this work into the
fresh context — everything the next context needs to continue, and nothing else.

Write it to `.mode-router/handoff.md` in the project root (create the directory if
needed) and **OVERWRITE** it, never append: one pending handoff at a time. Two
pending notes are two half-finished jobs, which is the user's problem to resolve,
not something this file should represent.

## The four sections

Exactly these four, in this order, and no others:

| Section | Holds |
|---|---|
| `## Prompt to send` | the exact text the user re-sends, verbatim and self-contained |
| `## Skills` | the commands the user re-types as one copy-paste block, each with a clause saying what is lost by skipping it, then the names the next context re-invokes itself |
| `## Decided` | bullets — only the decisions that *constrain* the next step |
| `## Next step` | one |

The actionable part comes first on purpose: the prompt is the only thing the user
acts on, so it has to be copyable without reading the rest.

**About 30 lines for the whole file.** No history, no replay of the discussion, no
superseded reasoning, and no fifth section for constraints or risks — that section
would just become the new place to pour the history the other four exclude. What
fits none of the four is not carried across.

## Filling `## Skills`

The router injects the raw material for this section on the turn you were invoked
on: a line opening `Recorded for the note —` that lists what entered this context,
split into what was **TYPED here** and what was **INVOKED here**. Use it — it is
keyed by a session id you cannot read yourself, so it cannot be reconstructed from
memory.

- The **typed** group comes from every slash command, not only skills, so one-shot
  actions (`/commit`, `/pr`) are in there too. Keep only what still shapes the
  work. A skill in that group may have no other way back: a declarative one has no
  description for the model to route on, so the user re-typing it is the only path.
  Give each keeper a clause saying what is lost by skipping it, so the user can
  judge — and note that it is **one slash per message**, before the prompt, since a
  message expands only its leading slash and swallows the rest as arguments.
- The **invoked** group the next context re-invokes itself, so just name those.

If no such line was injected, nothing else entered this context: say so in one
line and keep the section.

## Then stop

Writing the note is the whole turn. Say it is written, and tell the user to run
`/clear` and send the prompt the note names — do not start the work it describes.

If writing the file is impossible (plan mode, restricted permissions), put the
same four sections inline in the reply instead. It survives the turn but not the
`/clear`, so it is strictly worse: say that too.
