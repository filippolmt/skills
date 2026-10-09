#!/usr/bin/env node
// Differential check of every rewrite a deny message names. Run: node rewrites.test.js
// Each case runs the denied bash form under bash and the named rewrite under
// zsh, and wants the same output: the rewrite is the opt-out of the expansion
// rules (ADR-0022), so a wrong one turns a loud failure into a silent wrong
// result. Each case also asserts the hook still names that rewrite, so a changed
// message fails here until its case changes with it. Double quotes and empty
// arrays get their own cases: they are where a rewrite that looks right goes
// wrong (`"{1..$#h}"` stays literal).
//
// Coverage: every deny reason that guard.test.js and expansion.test.js produce
// is reduced to its shape (its backticked spans blanked), and each shape needs
// a case here. A new message branch thus fails this test until it has one. Two
// rewrites inside one shape (`$$` or `"$@"`) are told apart by their cases only.
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { harness } = require('./testing');

const hooks = { loop: harness('guard.js'), expansion: harness('expansion.js') };

// `hook` and `named`: the script that denies `bash`, and a text its reason
// carries. `sort`: compare lines sorted, where only the order is unspecified
// (an associative array's keys). `invalid`: bash rejects the form too, so there
// is no output to match; the rewrite must still run under zsh.
const CASES = [
  // --- for rule (guard.js) ---
  { hook: 'loop', named: '${=v}', setup: 'v="a b c"',
    bash: 'for x in $v; do echo "<$x>"; done', zsh: 'for x in ${=v}; do echo "<$x>"; done' },
  { hook: 'loop', named: '${(f)v}', setup: 'v=$(printf "a b\\nc")',
    bash: 'IFS=$\'\\n\'; for x in $v; do echo "<$x>"; done', zsh: 'for x in ${(f)v}; do echo "<$x>"; done' },

  // --- equals expansion ---
  { hook: 'expansion', named: "'====='", bash: 'echo =====', zsh: "echo '====='" },
  { hook: 'expansion', named: 'single `=`', bash: '[ a == a ] && echo same', zsh: '[ a = a ] && echo same' },

  // --- glob in a flag value: `a.md` exists, so bash leaves no-match words alone ---
  { hook: 'expansion', named: "--include='*.md'", bash: 'echo --include=*.md', zsh: "echo --include='*.md'" },

  // --- parentheses in a parameter pattern ---
  { hook: 'expansion', named: '`\\(`', setup: 'b="see (x, y)"',
    bash: 'echo "${b/(x, y)/X}"', zsh: 'echo "${b/\\(x, y\\)/X}"' },

  // --- bash's ${!…} ---
  { hook: 'expansion', named: '${(P)t}', setup: 'T0=zero; t=T0',
    bash: 'echo ${!t}', zsh: 'echo ${(P)t}' },
  { hook: 'expansion', named: '${(P)t}', setup: 'T0="a  b"; t=T0',
    bash: 'echo "${!t}"', zsh: 'echo "${(P)t}"' },
  { hook: 'expansion', named: '${(P)u:-d}', setup: 'u=UNSET_ZZQ',
    bash: 'echo "${!u:-d}"', zsh: 'echo "${(P)u:-d}"' },
  { hook: 'expansion', named: '${(P)1}', setup: 'T0=zero; set -- T0',
    bash: 'echo ${!1}', zsh: 'echo ${(P)1}' },
  { hook: 'expansion', named: '${(@ok)parameters[(I)ZZQ_*]}', setup: 'ZZQ_B=1; ZZQ_A=2',
    bash: 'for n in "${!ZZQ_@}"; do echo "<$n>"; done',
    zsh: 'for n in "${(@ok)parameters[(I)ZZQ_*]}"; do echo "<$n>"; done' },
  { hook: 'expansion', named: '${(ok)parameters[(I)ZZQ_*]}', setup: 'ZZQ_B=1; ZZQ_A=2',
    bash: 'for n in "${!ZZQ_*}"; do echo "<$n>"; done',
    zsh: 'for n in "${(ok)parameters[(I)ZZQ_*]}"; do echo "<$n>"; done' },
  { hook: 'expansion', named: '${(ok)parameters[(I)ZZQ_*]}', setup: 'ZZQ_B=1; ZZQ_A=2',
    bash: 'echo ${!ZZQ_*}', zsh: 'echo ${(ok)parameters[(I)ZZQ_*]}' },
  { hook: 'expansion', named: '${(@k)h}', sort: true,
    setup: { bash: 'declare -A h=([k 1]=a [k2]=b)', zsh: 'typeset -A h; h=("k 1" a k2 b)' },
    bash: 'for k in "${!h[@]}"; do echo "<$k>"; done', zsh: 'for k in "${(@k)h}"; do echo "<$k>"; done' },
  { hook: 'expansion', named: '${(@k)h}',
    setup: { bash: 'declare -A h=()', zsh: 'typeset -A h' },
    bash: 'for k in "${!h[@]}"; do echo "<$k>"; done; echo end', zsh: 'for k in "${(@k)h}"; do echo "<$k>"; done; echo end' },
  // Indices differ in base (bash 0, zsh 1), so the case compares what they index.
  { hook: 'expansion', named: '${(k)h}', setup: { bash: 'declare -A h=([k 1]=a)', zsh: 'typeset -A h; h=("k 1" a)' },
    bash: 'for k in "${!h[*]}"; do echo "<$k>"; done', zsh: 'for k in "${(k)h}"; do echo "<$k>"; done' },
  { hook: 'expansion', named: 'for ((i = 1; i <= $#a; i++))', setup: 'a=(x "y z" w)',
    bash: 'for i in "${!a[@]}"; do echo "<${a[$i]}>"; done',
    zsh: 'for ((i = 1; i <= $#a; i++)); do echo "<${a[$i]}>"; done' },
  { hook: 'expansion', named: 'for ((i = 1; i <= $#a; i++))', setup: 'a=()',
    bash: 'for i in "${!a[@]}"; do echo "<${a[$i]}>"; done; echo end',
    zsh: 'for ((i = 1; i <= $#a; i++)); do echo "<${a[$i]}>"; done; echo end' },
  { hook: 'expansion', named: '${argv[-1]}', setup: 'set -- a "b c"',
    bash: 'echo "${!#}"', zsh: 'echo "${argv[-1]}"' },
  { hook: 'expansion', named: '"$@"', invalid: true, setup: 'set -- a "b c"',
    bash: 'for x in "${!@}"; do echo "<$x>"; done', zsh: 'for x in "$@"; do echo "<$x>"; done' },
  { hook: 'expansion', named: '`$$`', invalid: true,
    bash: 'echo ${!$}', zsh: 'echo $$' },
];

// A reason's shape: per rule line (`- …`) in a multi-rule reason, else whole,
// with every backticked span blanked.
const shapes = (reason) => (reason.match(/^- .*$/gm) || [reason])
  .map((line) => line.replace(/`[^`]*`/g, '`…`'));

function shell(argv, script, cwd) {
  const r = spawnSync(argv[0], argv.slice(1).concat(script), { cwd: cwd, encoding: 'utf8' });
  assert.ok(!r.error, argv[0] + ' is required for this test: ' + (r.error && r.error.message));
  return r;
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zsh-rewrites-'));
fs.writeFileSync(path.join(cwd, 'a.md'), '');
const lines = (out, sort) => (sort ? out.split('\n').sort().join('\n') : out);

try {
  const covered = new Set();
  for (const c of CASES) {
    const reason = hooks[c.hook].denied(c.bash);
    assert.ok(reason.includes(c.named), 'the deny for `' + c.bash + '` no longer names ' + c.named);
    shapes(reason).forEach((shape) => covered.add(shape));
    const setup = typeof c.setup === 'object' ? c.setup : { bash: c.setup, zsh: c.setup };
    const prefix = (s) => (s ? s + '\n' : '');
    const want = shell(['bash', '--norc', '--noprofile', '-c'], prefix(setup.bash) + c.bash, cwd);
    const got = shell(['zsh', '-f', '-c'], prefix(setup.zsh) + c.zsh, cwd);
    const label = '`' + c.bash + '` -> `' + c.zsh + '`';
    if (c.invalid) {
      assert.notStrictEqual(want.status, 0, 'bash accepts ' + label + ': drop `invalid`');
      assert.strictEqual(got.status, 0, 'zsh fails on ' + label + ': ' + got.stderr);
      continue;
    }
    assert.strictEqual(want.status, 0, 'bash fails on ' + label + ': ' + want.stderr);
    assert.strictEqual(got.status, 0, 'zsh fails on ' + label + ': ' + got.stderr);
    assert.strictEqual(lines(got.stdout, c.sort), lines(want.stdout, c.sort), label);
  }

  const log = path.join(cwd, 'reasons.jsonl');
  for (const suite of ['guard.test.js', 'expansion.test.js']) {
    const r = spawnSync(process.execPath, [path.join(__dirname, suite)],
      { encoding: 'utf8', env: Object.assign({}, process.env, { ZSH_GUARD_REASONS: log }) });
    assert.strictEqual(r.status, 0, suite + ' failed: ' + r.stderr);
  }
  const missing = new Set();
  for (const line of fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)) {
    shapes(JSON.parse(line)).filter((shape) => !covered.has(shape)).forEach((shape) => missing.add(shape));
  }
  assert.ok(!missing.size, 'deny shapes with no rewrite case:\n' +
    [...missing].map((shape) => '  ' + shape.slice(0, 160)).join('\n'));
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}

console.log('zsh-wordsplit-guard rewrites: ' + CASES.length + ' match bash');
