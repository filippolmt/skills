#!/usr/bin/env node
// Self-check for session.js. Run: node session.test.js
// A new session and each subagent get the rule summary before their first
// Bash call: one line per rule family, short enough to ride every session.
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { FAMILIES } = require('./families');

function start(event) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'session.js')],
    { input: JSON.stringify({ hook_event_name: event, source: 'startup' }), encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).hookSpecificOutput;
}

for (const event of ['SessionStart', 'SubagentStart']) {
  const out = start(event);
  assert.strictEqual(out.hookEventName, event);
  assert.ok(/^The Bash tool runs zsh/.test(out.additionalContext), 'opens with the premise');
  for (const [id, line] of Object.entries(FAMILIES)) {
    assert.ok(out.additionalContext.includes(line), 'states the ' + id + ' family');
  }
  const words = out.additionalContext.split(/\s+/).length;
  assert.ok(words <= 120, 'a few lines, not ' + words + ' words');
}

// Wired for a new or cleared context and every subagent; a resume already holds it.
const hooks = require('./hooks.json').hooks;
const runs = (entries) => entries.some((e) => e.hooks.some((h) => /hooks\/session\.js/.test(h.command)));
assert.ok(hooks.SessionStart.some((e) => e.matcher === 'startup|clear|compact' && runs([e])), 'SessionStart wiring');
assert.ok(runs(hooks.SubagentStart), 'SubagentStart wiring');

console.log('zsh-wordsplit-guard session summary: all checks passed');
