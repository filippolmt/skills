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

  // Every stored-argument case keeps its verdict across the scanner's contexts.
  const argumentContexts = (check, setup, argument) => {
    const body = setup + '; cmd ' + argument;
    for (const command of [
      body,
      'if true; then ' + body + '; fi',
      'for item in one; do ' + body + '; done',
      setup + '; cmd ${unused} ' + argument,
      'echo $(' + body + ')',
      'echo "$(' + body + ')"',
      'cat <<EOF\n$(' + body + ')\nEOF',
    ]) check(command);
  };

  // The command a rewrite runs instead, checked to keep the rest of the input
  // (OTHER_FIELD among it) and to pass the hook itself.
  const OTHER_FIELD = { timeout: 5 };
  const rewritten = (command) => {
    const out = run(bash(command, OTHER_FIELD));
    assert.ok(out, 'expected a rewrite for: ' + command);
    const hso = out.hookSpecificOutput;
    assert.strictEqual(hso.permissionDecision, undefined, 'a rewrite keeps the permission flow: ' + command);
    assert.deepStrictEqual(Object.assign({}, hso.updatedInput, { command: command }),
      bash(command, OTHER_FIELD).tool_input, 'only the command changes');
    assert.ok(/^zsh-wordsplit-guard rewrote /.test(hso.additionalContext), 'tells the model');
    allowed(hso.updatedInput.command);
    return hso.updatedInput.command;
  };

  return { run, bash, denied, allowed, rewritten, argumentContexts };
}

module.exports = { harness };
