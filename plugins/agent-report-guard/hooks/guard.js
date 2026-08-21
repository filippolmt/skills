#!/usr/bin/env node
// agent-report-guard — one PreToolUse hook on the Agent tool.
//
// A NAMED Agent call is registered as an in-process mailbox teammate
// (`"taskKind": "in_process_teammate"` in the subagent's .meta.json). Its tool
// result is only "Spawned successfully… agent_id: NAME@session-…", and when the
// agent finishes the parent gets an `idle_notification` with NO report body —
// the report sits in the teammate's own transcript and has to be chased with
// SendMessage. An UNNAMED spawn reports back on its own: either the tool result
// carries the report, or a `task-notification` arrives with an `<output-file>`.
//
// Fan-out skills are written against "the report comes back": `code-review`
// spawns two axis agents and then reads their reports. Named, the parent waits
// on reports that never arrive and then chases them — observed live on 2.1.237:
// two axes spawned, two idle notifications with no body, two SendMessage rounds,
// one axis never delivering at all.
//
// So: drop the name and let the call through. `updatedInput` alone (no
// `permissionDecision`) is honoured for the Agent tool, which keeps the normal
// permission flow intact.
//
// On the headless (`claude -p`) path every spawn is async and reports via
// task-notification whether it is named or not, so there the rewrite is a no-op.
const fs = require('fs');

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) || {}; } catch (e) { /* no stdin */ }

const toolInput = input.tool_input || {};
// Both fields register the mailbox: `team_name` without `name` still routes the
// report to a team instead of back to the caller.
const named = ['name', 'team_name'].filter((k) => toolInput[k]);

// Nothing to rewrite — stay silent so the call takes its normal path.
// ALLOW_NAMED_AGENTS is the escape hatch for a deliberate teammate spawn.
if (input.tool_name !== 'Agent' || named.length === 0 || process.env.ALLOW_NAMED_AGENTS) {
  process.exit(0);
}

const updatedInput = Object.assign({}, toolInput);
for (const k of named) delete updatedInput[k];

process.stdout.write(JSON.stringify({
  // Silent rewriting would leave the model believing it has a teammate to
  // message. Say it out loud instead.
  systemMessage:
    'agent-report-guard: dropped ' +
    named.map((k) => k + '="' + toolInput[k] + '"').join(', ') +
    ' — a named agent becomes a mailbox teammate: it notifies idle without a ' +
    'report body, and the report then has to be chased with SendMessage. ' +
    'Spawned unnamed, so it reports back on its own. ' +
    'ALLOW_NAMED_AGENTS=1 keeps the name.',
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    updatedInput: updatedInput,
  },
}));
