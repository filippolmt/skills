#!/usr/bin/env node
// Self-check for guard.js. Run: node guard.test.js
// Payloads mirror the real PreToolUse shape; the named ones are the spawn that
// stalled /code-review (subagent_type general-purpose, name "standards-review").
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'guard.js');

function run(payload, env) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { ALLOW_NAMED_AGENTS: '' }, env || {}),
  });
  assert.strictEqual(r.status, 0, 'hook exited ' + r.status + ': ' + r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

const agent = (extra) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_input: Object.assign({
    description: 'Standards review of the diff',
    prompt: 'Review the diff against the repo standards.',
    subagent_type: 'general-purpose',
  }, extra),
});

// A named spawn is rewritten to an unnamed one, everything else untouched.
const named = run(agent({ name: 'standards-review' }));
assert.deepStrictEqual(named.hookSpecificOutput.updatedInput, agent().tool_input);
assert.strictEqual(named.hookSpecificOutput.hookEventName, 'PreToolUse');
assert.ok(/standards-review/.test(named.systemMessage), 'says which name it dropped');
assert.ok(/\[mailbox\]/.test(named.systemMessage), 'points at the per-call opt-out');
// No permissionDecision: the call keeps its normal permission flow.
assert.ok(!('permissionDecision' in named.hookSpecificOutput));

// Unrelated fields survive the rewrite.
const extra = run(agent({ name: 'spec', model: 'haiku', isolation: 'worktree' }));
assert.deepStrictEqual(
  extra.hookSpecificOutput.updatedInput,
  agent({ model: 'haiku', isolation: 'worktree' }).tool_input
);

// `team_name` is deprecated and ignored by the harness, so it is not touched —
// on its own it is not a mailbox, and alongside `name` it survives the rewrite.
assert.strictEqual(run(agent({ team_name: 'reviewers' })), null);
const withTeam = run(agent({ name: 'spec', team_name: 'reviewers' }));
assert.deepStrictEqual(
  withTeam.hookSpecificOutput.updatedInput,
  agent({ team_name: 'reviewers' }).tool_input
);

// Already unnamed: silent.
assert.strictEqual(run(agent()), null);

// Empty name is not a mailbox: silent.
assert.strictEqual(run(agent({ name: '' })), null);

// Another tool that happens to carry a `name`: not ours.
assert.strictEqual(run({ tool_name: 'Skill', tool_input: { name: 'whatever' } }), null);

// Per-call opt-out: a deliberate teammate keeps its name, anywhere in the
// description and whatever the case.
assert.strictEqual(run(agent({ name: 'watcher', description: '[mailbox] long-lived watcher' })), null);
assert.strictEqual(run(agent({ name: 'watcher', description: 'watcher [MAILBOX]' })), null);
// …and only that marker: a description merely talking about mailboxes still gets rewritten.
assert.ok(run(agent({ name: 'watcher', description: 'reads the mailbox' })));

// Session opt-out takes explicit values only — "0"/"false"/junk must not disable it.
for (const on of ['1', 'true', 'yes', 'TRUE']) {
  assert.strictEqual(run(agent({ name: 'x' }), { ALLOW_NAMED_AGENTS: on }), null, on + ' disables the guard');
}
for (const off of ['0', 'false', 'no', 'off', 'nope']) {
  assert.ok(run(agent({ name: 'x' }), { ALLOW_NAMED_AGENTS: off }), off + ' leaves the guard on');
}

// Garbage stdin must not crash the tool call.
const junk = spawnSync(process.execPath, [SCRIPT], { input: 'not json', encoding: 'utf8' });
assert.strictEqual(junk.status, 0);
assert.strictEqual(junk.stdout.trim(), '');

console.log('agent-report-guard: all checks passed');
