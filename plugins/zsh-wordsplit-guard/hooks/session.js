#!/usr/bin/env node
// zsh-wordsplit-guard, rule summary — SessionStart (startup, clear, compact) and
// SubagentStart: states every rule family before the first Bash call, so the
// agent writes the zsh form instead of learning it one rewrite at a time (#700).
const fs = require('fs');
const { summary } = require('./families');

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) || {}; } catch (e) { /* no stdin */ }
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: input.hook_event_name === 'SubagentStart' ? 'SubagentStart' : 'SessionStart',
    additionalContext: summary(),
  },
}));
