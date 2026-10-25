#!/usr/bin/env node
// Self-check for guard.js. Run: node guard.test.js
// Payloads mirror the real PreToolUse shape. The flagged ones are the form that
// runs once over the whole string under zsh; the allowed ones are every nearby
// form that is actually correct, which is where a guard this narrow earns its
// keep or becomes noise.
const assert = require('assert');
const { run, bash, denied, allowed } = require('./testing').harness('guard.js');

// --- the pattern that is silently wrong ---------------------------------------
const reason = denied('v="a b c"; for x in $v; do echo $x; done');
assert.ok(/\$\{=v\}/.test(reason), 'names the IFS-split fix');
assert.ok(/\$\{\(f\)v\}/.test(reason), 'names the per-line fix');
assert.ok(/"\$\{arr\[@\]\}"/.test(reason), 'names the array fix');
assert.ok(/\[nosplit\]/.test(reason), 'points at the per-call opt-out');
assert.ok(/ALLOW_ZSH_NOSPLIT=1/.test(reason), 'points at the session opt-out');
assert.ok(/Keep the split at the call site/.test(reason), 'names the target behaviour');
assert.ok(/`setopt shwordsplit` would change/.test(reason), 'rules the shell option out as a consequence, not an order');

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
// A glob yields several words whatever the option says, and a path separator
// marks a word built to BE one word — see
// docs/adr/0005-what-the-wordsplit-guard-flags.md for the measurement behind
// this exemption.
allowed('for f in $D/*; do echo $f; done');
allowed('for f in $D/opt-cold-*.log; do echo $f; done');
allowed('for f in $SRC/gateway/*.yaml; do echo $f; done');
allowed('for f in internal/$pkg/*.go; do echo $f; done');
allowed('for f in $D/a.log $D/b.log; do echo $f; done');
allowed('for x in $@; do echo $x; done');
allowed('for x in $1 $2; do echo $x; done');
allowed('echo "for x in $v"');                         // a header only inside a string

// Text glued on that is neither glob nor path leaves the word one word, so the
// body still runs once (each of these iterates once in zsh 5.9).
denied('for x in $v,; do echo $x; done');
denied('for x in $v.log; do echo $x; done');
denied('for x in $v$w; do echo $x; done');
denied('for x in ${v}x; do echo $x; done');
denied('for x in $v:$w; do echo $x; done');
denied('for f in a.log $files; do echo $f; done');
denied('for f in $exported; do echo $f; done');
// A backslash-continued header puts the list on the next line, where the scan
// has to follow it.
denied('for x in \\\n$v; do echo $x; done');

// A braced expansion carrying a modifier does not split either (checked in zsh
// 5.9: `${v:-a b c}` and `${w#x}` both give one iteration).
denied('for x in ${v:-a b c}; do echo $x; done');
denied('for x in ${v#prefix}; do echo $x; done');
denied('for x in ${v/a/b}; do echo $x; done');

// --- what is NOT scanned, and only what is ------------------------------------
// A quoted payload is blanked, so a loop inside one is invisible. That covers
// `bash -c` for free — its body runs under a shell that does split — and takes
// `zsh -c` with it, which is the acknowledged cost.
allowed("bash -c 'for x in $v; do echo $x; done'");
allowed('bash -lc "for x in \\$v; do echo x; done"');
allowed("zsh -c 'for x in $v; do echo $x; done'");
// But a `-c` anywhere on the line must NOT excuse a loop that IS zsh's.
denied('for f in $files; do bash -c "echo hi"; done');
denied('for f in $files; do ./deploy.sh -c prod; done');
denied('for f in $files; do echo $f; done # deploy.sh -c runs elsewhere');

// A `#` comment is not code: neither denied, nor able to hide a real loop.
allowed('echo hi # for x in $v; do :; done');
denied('for x in $v; do echo $x; done # iterate the changed files');
allowed('echo "no # comment here"');

// A heredoc body is text up to its terminator line; around it is still zsh,
// and a here-string (`<<<`) is zsh throughout.
allowed('cat <<EOF\nfor x in $v; do echo $x; done\nEOF');
allowed("cat <<'EOF'\nfor x in $v; do echo $x; done\nEOF");
allowed('cat <<-EOF\n\tfor x in $v; do :; done\n\tEOF');
denied('for f in $v; do echo $f; done\ncat <<EOF\nplain text\nEOF');
denied('cat <<EOF\nplain text\nEOF\nfor f in $v; do echo $f; done');
denied('cat <<-EOF\n\tplain\n\tEOF\nfor f in $v; do :; done');
denied('for x in $v; do echo $x; done <<<"seed"');

// The array escape hatch is ordered: only an assignment BEFORE the loop counts.
denied('for i in $a; do echo $i; done; a=(uno due)');

denied('a=(x y); unset a; a="x y"; for x in $a; do echo "$x"; done');
denied('a=(x y); a="x y"; for x in $a; do echo "$x"; done');
denied('a=(x y); unset -v a; for x in $a; do :; done');
denied('a=(x y); unset other a third; for x in $a; do :; done');
denied('a=(x y); export a="x y"; for x in $a; do :; done');
denied('a=(x y); b=1 a="x y"; for x in $a; do :; done');
allowed('a=(x y); unset other; for x in $a; do :; done');
allowed('a=(x y); unset a; a=(p q); for x in $a; do :; done');
allowed('a=(x y); echo a=scalar; for x in $a; do :; done');

// A substitution is a shell of its own, not a reason to hide its loops or
// the reassignment that invalidates an earlier array exemption.
for (const wrap of [s => s, s => 'out=$(' + s + ')', s => 'echo "$(' + s + ')"',
  s => 'cat <<EOF\n$(' + s + ')\nEOF', s => 'echo "$(echo "$(' + s + ')")"']) {
  denied(wrap('a=(x y); unset a; a="x y"; for x in $a; do echo "$x"; done'));
  denied(wrap('a=(x y); a="x y"; for x in $a; do echo "$x"; done'));
  denied(wrap('for x in $v; do echo "$x"; done'));
  allowed(wrap('a=(x y); for x in $a; do echo "$x"; done'));
  allowed(wrap('for x in $(printf "%s\\n" $v); do echo "$x"; done'));
  allowed(wrap('for x in $(echo $(echo $(printf "%s\\n" $v))); do :; done'));
  allowed(wrap('for x in `printf "%s\\n" $v`; do :; done'));
  allowed(wrap('echo "for x in $v; do :; done"'));
  allowed(wrap("bash -c 'for x in $v; do :; done'"));
}
// Completed child substitutions cannot change the current shell's array type.
for (const child of ['$(a="x y")', '$(unset a)', '`a="x y"`', '$(echo $(a="x y"))']) {
  allowed('a=(x y); out=' + child + '; for x in $a; do printf "<%s>" "$x"; done');
  allowed('a=(x y); echo "$(out=' + child + '; for x in $a; do :; done)"');
}
allowed('a=(x y); out=$(for x in $a; do printf "<%s>" "$x"; done)');
allowed('a=(x y); echo "$(echo "$(for x in $a; do :; done)")"');
denied('out=$(a=(x y)); for x in $a; do :; done');
denied('a=(x y); out=$(unset a; a="x y"; for x in $a; do :; done)');

// A keyword in argument position is not a loop, even inside a substitution.
for (const wrap of [s => s, s => 'out=$(' + s + ')', s => 'echo "$(' + s + ')"',
  s => 'cat <<EOF\n$(' + s + ')\nEOF']) {
  allowed(wrap('echo for x in $v'));
  allowed(wrap('echo then for x in $v'));
  allowed(wrap('echo for c in "a b"; echo $c'));
  denied(wrap('if true; then for x in $v; do :; done; fi'));
  denied(wrap('for y in a b; do for x in $v; do :; done; done'));
  denied(wrap('{ for x in $v; do :; done; }'));
}

// The outer list is a splitting substitution, but the loop inside still isn't.
denied('for y in $(for x in $v; do echo "$x"; done); do echo "$y"; done');
allowed('echo "$(echo \'for x in $v; do :; done\')"');
allowed("cat <<'EOF'\n$(for x in $v; do :; done)\nEOF");

// --- a loop variable built to hold several words -----------------------------
// A list of quoted literals holding whitespace exists only to be split again in
// the body; an unquoted `$c` there stays one word (docs/adr/0027).
const itemReason = denied('for c in "tests/a.py /nope" "tests/b.py /nope /nope"; do python3 $c; done');
assert.ok(/\$\{=c\}/.test(itemReason), 'names the IFS-split fix for the loop variable');
assert.ok(/for c in a b; do cmd "\$c" arg; done/.test(itemReason), 'names one item per loop word');
assert.ok(/\[nosplit\]/.test(itemReason), 'points at the per-call opt-out');
denied('for c in "a b" "c d"; do printf "[%s]\\n" ${c}; done');  // braced
denied("for c in 'a b' 'c d'; do echo $c; done");                // single quotes
denied('for c in x "a b"; do\n  echo $c\ndone');                // one such word is enough
// Every context the masked view exposes: `$(…)`, inside double quotes, heredoc body.
denied('out=$(for c in "a b"; do echo $c; done)');
denied('echo "$(for c in "a b"; do echo $c; done)"');
denied('cat <<EOF\n$(for c in "a b"; do echo $c; done)\nEOF');

denied('for c in "a b"; do echo done $c; done');                 // `done` as an argument ends nothing
denied('for c in "a b"; do for d in x y; do :; done; python3 $c; done'); // after a nested loop
denied('for c in "a b"; do\n  while false; do :; done\n  python3 $c\ndone');
denied('for c in "a b"; do echo ${c:-x}; done');                 // a modifier does not split either
denied('for c in "a.py -v"; do python3 ${c%.py}; done');
denied('for c ("a b" "c d"); do python3 $c; done');              // zsh's short form
assert.ok(/for c arg in a x b y; do cmd "\$c" "\$arg"; done/.test(itemReason), 'names several loop variables');
allowed('for c ("a b" "c d"); do python3 "$c"; done');
allowed('for c in "a b"; do for d in x y; do :; done; done; echo $c'); // after the outer loop
allowed('for c in "a b"; do echo ${#c}; done');                  // a length is one word

allowed('for c in "a b" "c d"; do echo "$c"; done');             // quoted use: one word, as asked
// Where zsh never splits anyway — and neither does bash — one word is right.
allowed('for c in "a b"; do [[ -n $c ]] && echo ok; done');
for (const wrap of [s => s, s => 'out=$(' + s + ')', s => 'echo "$(' + s + ')"', s => 'cat <<EOF\n$(' + s + ')\nEOF']) {
  allowed(wrap('for c in "1 + 2"; do (( n = $c )); printf "%s\\n" "$n"; done'));
  denied(wrap('for c in "1 + 2"; do (( n = $c )); echo done $c; done'));
}
allowed('for c in "a b"; do x=$c; echo "$x"; done');
allowed('for c in "a b"; do case $c in a*) echo a;; esac; done');
allowed('for f in "a.txt" "b.txt"; do cat $f; done');            // single-word items
allowed('for c in "a b"; do echo ${=c}; done');                  // explicit split
allowed('for c in "a b"; do echo $cx; done');                    // another variable
allowed('for c in "a b"; do :; done; echo $c');                  // after the loop
allowed('for c in "$x y"; do echo $c; done');                    // not literal text
// A quoted literal inside a substitution is that command's argument, not an item.
allowed("for d in $(find . -newermt '-15 minutes'); do ls $d; done");
allowed("for d in `find . -newermt '-15 minutes'`; do ls $d; done");
allowed('for p in ${(f)"$(kubectl get pods | awk \'{print $1}\')"}; do echo $p; done');
allowed("for f in $( (git status | awk '{print $2}'; git diff --name-only) ); do lint $f; done");
// `eval` parses its arguments again, which splits them.
allowed('for a in "x y" "z w"; do eval cmd $a; done');
allowed('for c in "a b"; do echo $c; done', { description: 'deliberate [nosplit]' });
allowed("cat <<'EOF'\nfor c in \"a b\"; do echo $c; done\nEOF");  // literal heredoc body

// --- opt-outs and unrelated calls --------------------------------------------
allowed('for x in $v; do echo $x; done', { description: 'deliberate [nosplit]' });
allowed('for x in $v; do echo $x; done', { description: 'deliberate [NOSPLIT]' });
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
