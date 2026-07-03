#!/usr/bin/env node
// Self-check for route.js. Run: node route.test.js
// Verifies the reload-flag state machine end to end via real subprocess runs.
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'route.js');
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-router-test-'));
const SID = 'sess-1';

// Run route.js with an isolated XDG_CONFIG_HOME; return stdout.
function run(event, prompt) {
  const payload = { hook_event_name: event, session_id: SID };
  if (prompt != null) payload.prompt = prompt;
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(payload),
    env: { ...process.env, XDG_CONFIG_HOME: CFG },
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  return r.stdout;
}

function setMode(mode) {
  fs.mkdirSync(path.join(CFG, 'mode-router'), { recursive: true });
  fs.writeFileSync(path.join(CFG, 'mode-router', 'state.json'), JSON.stringify({ mode }));
}

// --- auto (default): classifier fires every turn; reset vs keep wording ---
run('SessionStart');
let out = run('UserPromptSubmit', 'explain this');
assert.match(out, /MODE ROUTER/);
assert.match(out, /just \(re\)started or compacted/, 'first prompt after start => reset wording');
assert.match(out, /Precedence:/, 'auto reset => precedence clause present');

out = run('UserPromptSubmit', 'explain more');
assert.match(out, /MODE ROUTER/);
assert.match(out, /only when switching modes/, 'no reset => keep wording');

// compaction fires SessionStart again => next prompt is reset again
run('SessionStart');
out = run('UserPromptSubmit', 'after compaction');
assert.match(out, /just \(re\)started or compacted/, 'post-compaction => reset wording');

// slash mode-skill dispatch => no classifier
out = run('UserPromptSubmit', '/caveman hi');
assert.strictEqual(out, '', '/caveman => empty');

// --- forced caveman: deterministic, reload ONLY on reset ---
setMode('caveman');
run('SessionStart');
out = run('UserPromptSubmit', 'anything');
assert.match(out, /Forced caveman mode/, 'reset => invoke forced skill');
assert.match(out, /Precedence:/, 'forced caveman reset => precedence clause present');
out = run('UserPromptSubmit', 'anything else');
assert.strictEqual(out, '', 'no reset => nothing (skill persists)');

// --- off: never emits ---
setMode('off');
run('SessionStart');
out = run('UserPromptSubmit', 'anything');
assert.strictEqual(out, '', 'off => empty even after reset');

fs.rmSync(CFG, { recursive: true, force: true });
console.log('ok');
