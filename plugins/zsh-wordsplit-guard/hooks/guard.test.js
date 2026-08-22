#!/usr/bin/env node
// Self-check for guard.js. Run: node guard.test.js
// Payloads mirror the real PreToolUse shape. The flagged ones are the form that
// runs once over the whole string under zsh; the allowed ones are every nearby
// form that is actually correct, which is where a guard this narrow earns its
// keep or becomes noise.
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'guard.js');

function run(payload, env) {
  const r = spawnSync(process.execPath, [SCRIPT], {
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
  tool_input: Object.assign({ command: command, description: 'Run a loop' }, extra),
});

const denied = (command, extra) => {
  const out = run(bash(command, extra));
  assert.ok(out, 'expected a deny for: ' + command);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny', command);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  return out.hookSpecificOutput.permissionDecisionReason;
};

const allowed = (command, extra) =>
  assert.strictEqual(run(bash(command, extra)), null, 'expected no deny for: ' + command);

// --- the pattern that is silently wrong ---------------------------------------
const reason = denied('v="a b c"; for x in $v; do echo $x; done');
assert.ok(/\$\{=v\}/.test(reason), 'names the IFS-split fix');
assert.ok(/\$\{\(f\)v\}/.test(reason), 'names the per-line fix');
assert.ok(/"\$\{arr\[@\]\}"/.test(reason), 'names the array fix');
assert.ok(/\[nosplit\]/.test(reason), 'points at the per-call opt-out');
assert.ok(/ALLOW_ZSH_NOSPLIT=1/.test(reason), 'points at the session opt-out');
assert.ok(/Do not use `setopt shwordsplit`/.test(reason), 'rules shwordsplit out rather than offering it');

denied('for x in ${v}; do echo $x; done');            // braced form
denied('for f in $files\ndo\n  rm "$f"\ndone');       // newline before do
denied('echo hi\nfor f in $changed; do echo $f; done'); // not on the first line

// --- forms that are correct in zsh -------------------------------------------
allowed('for f in $(git diff --name-only); do echo $f; done'); // substitution splits
allowed('for f in `ls`; do echo $f; done');
allowed('for x in ${=v}; do echo $x; done');           // explicit IFS split
allowed('for x in ${(f)v}; do echo $x; done');         // explicit per-line split
allowed('for x in "${a[@]}"; do echo $x; done');       // quoted array
allowed('for x in ${a[@]}; do echo $x; done');         // array, splits regardless
allowed('a=(uno due tre); for x in $a; do echo $x; done'); // array assigned here
allowed('for f in *.js; do echo $f; done');            // glob
allowed('for x in uno due tre; do echo $x; done');     // literal list
allowed('for x in "$v"; do echo $x; done');            // deliberate single word
allowed('for x in "$@"; do echo $x; done');            // positionals, idiomatic
allowed('for x in $@; do echo $x; done');
allowed('for x in $1 $2; do echo $x; done');
allowed('echo "for x in $v"');                         // a header only inside a string

// A body that does not run under zsh: skipped whole, false negative on purpose.
allowed('cat <<EOF\nfor x in $v; do echo $x; done\nEOF');
allowed("bash -c 'for x in $v; do echo $x; done'");
allowed('bash -lc "for x in \\$v; do echo x; done"');
// A here-string is zsh, not another shell: it must not buy the heredoc skip.
denied('for x in $v; do echo $x; done <<<"seed"');

// --- opt-outs and unrelated calls --------------------------------------------
allowed('for x in $v; do echo $x; done', { description: 'deliberate [nosplit]' });
assert.strictEqual(
  run(bash('for x in $v; do echo $x; done'), { ALLOW_ZSH_NOSPLIT: '1' }), null,
  'session opt-out honoured');
assert.ok(
  run(bash('for x in $v; do echo $x; done'), { ALLOW_ZSH_NOSPLIT: '0' }),
  'ALLOW_ZSH_NOSPLIT=0 means off, not "non-empty therefore on"');

assert.strictEqual(run({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: {} }), null,
  'another tool is not this hook business');
assert.strictEqual(run(bash('')), null, 'no command, nothing to check');
assert.strictEqual(run({}), null, 'empty payload is silent');

console.log('zsh-wordsplit-guard: all checks passed');
