#!/usr/bin/env node
// zsh-wordsplit-guard, rule summary — SessionStart (startup, clear, compact) and
// SubagentStart: states every rule family before the first Bash call, so the
// agent writes the zsh form instead of learning it one rewrite at a time (#700).
const { readPayload } = require('./scan');
const { summary } = require('./families');

const input = readPayload();
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: input.hook_event_name === 'SubagentStart' ? 'SubagentStart' : 'SessionStart',
    additionalContext: summary(),
  },
}));
