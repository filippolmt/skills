---
status: accepted
---

# agent-report-guard keeps the rewrite in auto mode

In auto mode, a PreToolUse hook that returns `updatedInput` with no
`permissionDecision` can see the changed call denied: the classifier reviewed
the input Claude wrote, not the one the hook returned. Claude then re-sends the
call as rewritten, and it passes. For `agent-report-guard`, every named Agent
call can therefore cost one extra round. One session re-sent two parallel
batches of long prompts this way (#738).

#738 proposed skipping the rewrite when `permission_mode` is `"auto"`, on the
grounds that auto mode delivers subagent reports through `SubagentHandback`.
Measured on 2.1.327 in auto mode, a named Agent call still spawns an in-process
mailbox teammate. That teammate has no `SubagentHandback`, and its idle
notification carries a truncated report. Skipping the rewrite would bring back
the failure the guard exists for.

## The line

- **Keep the rewrite, with no decision field** (as ADR-0025 sets out). The cost
  is at most one denial per call, and the retry is the fix the hooks docs give.
- **No `allow`:** it would skip the classifier review of every rewritten call.
- **No `ask`:** in auto mode it normally sends the call to the permission
  prompt.
- **No `deny`:** asking for an unnamed re-send costs the same retry.
- **Say it to the model.** The explanation goes out as `additionalContext` as
  well as `systemMessage`, which reaches only the user. The text says how to
  answer the denial: re-send without `name`. A headless auto-mode run showed
  that the model receives the context even when the call is denied.

## Reopen when

A named Agent call in auto mode gets `SubagentHandback`, or its idle
notification carries the whole report. At that point the rewrite would be a
pure cost in auto mode.
