#!/usr/bin/env node
// agent-report-guard — one PreToolUse hook on the Agent tool.
//
// A NAMED Agent call is registered as an in-process mailbox teammate
// (`"taskKind": "in_process_teammate"` in the subagent's .meta.json): the tool
// result is only "Spawned successfully…" and the report has to be pulled out of
// the teammate's own transcript with SendMessage. An UNNAMED call returns the
// report inline. Measured over real transcripts: 107 named calls → 313 B median
// result (max 331, always the boilerplate); 204 unnamed → 3089 B median.
//
// Fan-out skills are written against the inline shape — `code-review` spawns two
// axis agents and then reads their reports — so a named spawn stalls them: the
// parent waits for a report that is never coming.
//
// So: drop the name and let the call through. `updatedInput` alone (no
// `permissionDecision`) is honoured for the Agent tool, which keeps the normal
// permission flow intact.
const fs = require('fs');

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) || {}; } catch (e) { /* no stdin */ }

const toolInput = input.tool_input || {};
// Both fields register the mailbox: `team_name` without `name` still routes the
// report to a team instead of the tool result.
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
    ' — a named agent becomes a mailbox teammate whose report never returns as the ' +
    'tool result. Spawned unnamed, so the report comes back inline. ' +
    'ALLOW_NAMED_AGENTS=1 keeps the name.',
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    updatedInput: updatedInput,
  },
}));
