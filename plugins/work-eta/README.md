# work-eta

A mod that tells you, roughly, when the work you launched will finish:

```
ends in 12m 35s (≈17:42) · 2 subagents · slowest: scan the repo
```

## What a work is

A **work** is one uninterrupted busy period of the session: it starts with the
main-loop turn your prompt starts and ends when the main turn has completed
**and** no subagent of the session is `pending`, `running` or `waiting` in
`$.agent.list()`. A turn that ends while background subagents run does not end
the work; a turn started while a work is in progress continues it. A turn no
prompt of yours started (a background task's notification waking the session)
starts none. Not to be confused with a *workflow*.

The start is the turn's, not the prompt's: a built-in command such as `/clear`
submits a prompt and runs no turn, so a work started at the prompt would never
end. A prompt counts as yours unless its origin is a task notification.

## The line

Shown above the prompt only while a work is in progress, refreshed every 5 s.

- **Countdown**: `ends in 12m 35s (≈17:42)`, the time left and the clock time the
  work should end, from the 90th percentile of your past works of the same bucket
  that lasted at least as long as the current one. It counts down in 5 s steps and
  sharpens as the work runs, so it can jump when the work outlasts a sample.
- Fewer than 5 such works: `longer than usual (Nm+)`, with no countdown.
- Fewer than 20 recorded works in that bucket: `work running 40s`, the elapsed
  time (seconds in the first minute, whole minutes after). Nothing is seeded.
- **Bucket**: with or without subagents. The band switches to "with" when the first
  subagent starts; a work is recorded as "with" if any subagent ran, a teammate
  included.
- **slowest**: the description of the active subagent seen running longest.
- Interrupted works are not recorded.

History lives in the mod's `$.store`, shared by every session of your user: the
last 200 durations per bucket. Two sessions finishing at once may lose a sample.

## Limitations

- Claude Code 2.1.290 or later (tested on 2.1.314). The line is plain text, with
  none of the style props added in 2.1.299. The band shows on the terminal and
  the Desktop app, not in VS Code.
- Durations are wall-clock, permission prompts included: the mod API cannot
  isolate the time spent waiting on you.
- Workflow runs and other sessions are not counted: `$.agent.list()` does not
  list a workflow's agents, so a work that is only a Workflow run is recorded too
  short.
- The work's end is seen within 5 s (the poll period). Only native events are
  used, no `classic.*` hooks, so the mod also runs where those are disabled.
- A session that draws nowhere (`claude -p`, an SDK host before a client
  attaches) starts no work: nothing is shown or recorded.
- Claude Code only: Codex and pi cannot load a mod.

## Install

```
/plugin install work-eta@filippo-skills
```
