#!/usr/bin/env node
// agent-report-guard — one PreToolUse hook on the Agent tool.
//
// A NAMED Agent call is registered as an in-process mailbox teammate
// (`"taskKind": "in_process_teammate"` in the subagent's .meta.json). Its tool
// result is only "Spawned successfully… agent_id: NAME@session-…", and when the
// agent finishes the parent gets an `idle_notification` whose `result` is
// truncated (2.1.327) — the full report sits in the teammate's own transcript
// and has to be chased with SendMessage. A teammate gets no `SubagentHandback`,
// in auto mode included. An UNNAMED spawn reports back on its own: the tool
// result, a `task-notification`, or (auto mode) `SubagentHandback` carries it.
//
// Fan-out skills are written against "the report comes back": `code-review`
// spawns two axis agents and then reads their reports. Named, the parent waits
// on reports that never arrive and then chases them — observed live on 2.1.237:
// two axes spawned, two idle notifications with no body, two SendMessage rounds,
// one axis never delivering at all.
//
// So: drop the name and let the call through. `updatedInput` alone (no
// `permissionDecision`) keeps the normal permission flow intact. In auto mode
// that costs one retry: the classifier reviewed the input Claude wrote, so the
// rewritten call is denied once and Claude re-sends it unnamed (#738). `allow`
// would skip the classifier and `ask` would prompt every time, so the retry stays.
//
// A mailbox teammate is a real harness feature, so both opt-outs are honoured:
//   - per call    — put `[mailbox]` in the Agent call's `description`
//   - session     — ALLOW_NAMED_AGENTS=1
//
// On the headless (`claude -p`) path every spawn is async and reports back
// whether it is named or not, so there the rewrite is a no-op.
const fs = require('fs');

// Only `name` registers the mailbox. `team_name` is deprecated and ignored by
// the harness, so it is left alone.
const MAILBOX_FIELD = 'name';
// Opt-in marker for a deliberate teammate, per call. Anywhere in `description`.
const MAILBOX_OPT_IN = /\[mailbox\]/i;
// Explicit values only: `ALLOW_NAMED_AGENTS=0` must mean off, not "non-empty
// string, therefore on".
const ON = new Set(['1', 'true', 'yes']);

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) || {}; } catch (e) { /* no stdin */ }

const toolInput = input.tool_input || {};
const optedOut =
  ON.has(String(process.env.ALLOW_NAMED_AGENTS || '').toLowerCase()) ||
  MAILBOX_OPT_IN.test(toolInput.description || '');

// Nothing to rewrite — stay silent so the call takes its normal path.
if (input.tool_name !== 'Agent' || !toolInput[MAILBOX_FIELD] || optedOut) {
  process.exit(0);
}

const updatedInput = Object.assign({}, toolInput);
delete updatedInput[MAILBOX_FIELD];

// Silent rewriting would leave the model believing it has a teammate to
// message, and `systemMessage` reaches only the user: the model reads
// `additionalContext`. The note names the per-call opt-out so the next call
// can take it.
const note =
  'agent-report-guard: dropped name="' + toolInput[MAILBOX_FIELD] + '" — a named ' +
  'agent becomes a mailbox teammate: it notifies idle with a truncated report, and ' +
  'the rest has to be chased with SendMessage. Spawned unnamed: wait for its ' +
  'report, which comes back on its own. In auto mode this call may be denied once; ' +
  're-send it without name. If you really want a teammate ' +
  'to message, put [mailbox] in the description (or set ALLOW_NAMED_AGENTS=1 for ' +
  'the session).';

process.stdout.write(JSON.stringify({
  systemMessage: note,
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    updatedInput: updatedInput,
    additionalContext: note,
  },
}));
