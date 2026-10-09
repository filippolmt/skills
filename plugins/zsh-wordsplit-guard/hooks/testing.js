// Shared by guard.test.js and expansion.test.js: run one hook script on a real
// PreToolUse payload and assert its verdict.
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function harness(scriptName) {
  const script = path.join(__dirname, scriptName);

  function run(payload, env) {
    const r = spawnSync(process.execPath, [script], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: Object.assign({}, process.env, { ALLOW_ZSH_NOSPLIT: '' }, env || {}),
    });
    assert.strictEqual(r.status, 0, 'hook exited ' + r.status + ': ' + r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  }

  const bash = (command, extra) => ({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: Object.assign({ command: command, description: 'Run it' }, extra),
  });

  const denied = (command, extra) => {
    const out = run(bash(command, extra));
    assert.ok(out, 'expected a deny for: ' + command);
    assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny', command);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    const reason = out.hookSpecificOutput.permissionDecisionReason;
    // rewrites.test.js collects every reason the suites produce, one JSON per line.
    if (process.env.ZSH_GUARD_REASONS) fs.appendFileSync(process.env.ZSH_GUARD_REASONS, JSON.stringify(reason) + '\n');
    return reason;
  };

  const allowed = (command, extra) =>
    assert.strictEqual(run(bash(command, extra)), null, 'expected no deny for: ' + command);

  return { run, bash, denied, allowed };
}

module.exports = { harness };
