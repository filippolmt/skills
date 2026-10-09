#!/usr/bin/env node
// Self-check for expansion.js. Run: node expansion.test.js
// The denied commands fail or give a wrong result under zsh 5.9; the allowed
// ones are the nearby forms that run as written, including the correct rewrite
// of each denied one.
const assert = require('assert');
const { run, bash, denied, allowed } = require('./testing').harness('expansion.js');

// --- equals expansion ---------------------------------------------------------
let reason = denied('echo =====');
assert.ok(/'====='/.test(reason), 'names the quoted form');
assert.ok(/\$\{commands\[name\]\}/.test(reason), 'names the command-path form');
denied('echo =ls');                       // silently prints /usr/bin/ls
denied('echo foo =bar');
reason = denied('[ "$a" == "$b" ] && echo same'); // `==` is a word to `[`
assert.ok(/^- Equals expansion: `==`\. [^\n]*Inside `\[ \]` or `test`, compare with a single `=`/m.test(reason),
  'for `==`, the `[ ]` rewrite comes first');
assert.ok(!/run the command again/.test(reason), 'no closing line restating the rewrite');
denied('test a == b');
denied('echo ok; echo ==');

allowed("echo '====='");
allowed('echo "====="');
allowed('echo \\=====');
allowed('X=1 cmd');
allowed('echo a==b --x=y');
allowed('[[ $a == $b ]] && echo same');
allowed('[[ $a == b && $c == d ]]');
allowed('[ "$a" = "$b" ]');
allowed('(( a == b ))');
allowed('echo $(( 1 == 1 ))');
allowed('echo =');                        // a lone `=` is literal
allowed('diff =(sort a) =(sort b)');      // process substitution
allowed('a=(x y)');
allowed('echo hi # ===== a comment');

// --- glob in a flag value ------------------------------------------------------
reason = denied('grep -rn --include=*.md pattern .');
assert.ok(/--include='\*\.md'/.test(reason), 'names the quoted flag');
assert.ok(/no matches found/.test(reason), 'names the failure');
denied('grep -r --exclude-dir=node_* x .');
denied('rg --glob=*.ts foo');
denied('git log --format=[%h] -1');
denied('ls --x=?');

allowed("grep -rn --include='*.md' pattern .");
allowed('grep -rn --include="*.md" pattern .');
allowed('grep -rn --include=\\*.md pattern .');
allowed('grep -rn --include=README.md pattern .');
allowed('ls *.md');                       // a plain glob is what the author wants
allowed('cmd --x=${a[1]}');               // subscript, not a glob
allowed('echo --x=$a[1]');                // zsh array subscript, prints --x=p
allowed("bash -c 'grep --include=*.md x .'");

// --- parentheses in a parameter pattern ---------------------------------------
reason = denied('b="see (issue tracker, domain docs)"; echo "${b/(issue tracker, domain docs)/X}"');
assert.ok(/python or sed/.test(reason), 'names the out-of-shell replacement');
assert.ok(/\\\(/.test(reason), 'names the escape');
denied('echo ${b//(x)/y}');
denied('echo ${b%(z)}');
denied('echo ${b#x(}');
denied('echo ${x:/(a)/b}');               // whole-match form
denied('echo ${x/${y}(a)/b}');            // a nested expansion before the group
denied('cat <<EOF\n${b/(x)/y}\nEOF');      // an unquoted heredoc body expands

allowed('echo ${b/\\(x\\)/y}');            // escaped
allowed('echo ${b/(a|b)/Q}');             // alternation, on purpose
allowed('echo ${b/(#b)(foo)/$match[1]}'); // pattern flags, on purpose
allowed('echo ${b/$(date)/now}');         // command substitution in the pattern
allowed('print -r -- ${x/[(]/b}');        // bracket class: a literal parenthesis
allowed('echo ${b/x/(y)}');               // parentheses in the replacement
allowed('echo ${b//[^a-z]/}');            // a glob class: same meaning as in bash
allowed('echo ${(f)b} ${#b} ${=b}');
allowed("echo '${b/(x)/y}'");             // single quotes: not expanded

// --- indirect expansion -------------------------------------------------------
reason = denied('for n in 0 1 2; do t="T$n"; gh issue create -f title="${!t}"; done');
assert.ok(/^- Indirect expansion: `\$\{!t\}`\./m.test(reason), 'quotes the form');
assert.ok(/bad substitution/.test(reason), 'names the failure');
assert.ok(/Write `\$\{\(P\)t\}`\.$/.test(reason), 'names the exact rewrite');
reason = denied('echo ${!t:-default}');
assert.ok(/`\$\{\(P\)t:-default\}`/.test(reason), 'the rewrite keeps the modifier');
reason = denied('set -- HOME; echo ${!1}');  // positional indirection
assert.ok(/`\$\{\(P\)1\}`/.test(reason), 'positional rewrite');
reason = denied('echo ${!T*}');
assert.ok(/^- Name list: /m.test(reason), 'labels the name list');
assert.ok(/\$\{\(ok\)parameters\[\(I\)T\*\]\}/.test(reason), 'names the sorted parameters lookup');
denied('echo "${!GIT_@}"');
reason = denied('for k in "${!h[@]}"; do echo $k; done');
assert.ok(/^- Key list: /m.test(reason), 'labels the key list');
assert.ok(/"\$\{\(@k\)h\}"/.test(reason), 'keys: a form that survives double quotes');
assert.ok(/\$\(seq \$#h\)` outside double quotes/.test(reason), 'indices: empty-safe, unquoted');
reason = denied('echo "${!#}"');
assert.ok(/^- Last argument: `\$\{!#\}`\./m.test(reason), 'labelled like the other reasons');
assert.ok(/\$\{argv\[-1\]\}/.test(reason) && /no error/.test(reason), 'last argument: silent');
reason = denied('echo ${!@}');            // zsh aborts; bash rejects it too
assert.ok(/"\$@"/.test(reason), 'names the arguments');
denied('echo ${!*}');
reason = denied('echo ${!$}');
assert.ok(/`\$\$`/.test(reason), 'names the shell PID');
reason = denied('echo ${!t');              // unterminated: the rewrite is closed
assert.ok(/`\$\{!t\}`/.test(reason) && /Write `\$\{\(P\)t\}`\.$/.test(reason), 'quoted closed');
denied('cat <<EOF\ntitle: ${!t}\nEOF');    // an unquoted heredoc body expands
denied('cat <<-EOF\n\t${!t}\n\tEOF');

allowed('sleep 1 & echo ${!} $!');        // `${!}` is `$!` in both shells
allowed('echo ${!-none} ${!:-none}');
allowed('echo ${(P)t} ${#t} ${(k)h}');
allowed("echo '${!t}'");                  // single quotes: not expanded
allowed('echo \\${!t}');
allowed("bash -c 'echo ${!t}'");
allowed("cat <<'EOF'\n${!t}\nEOF");      // a quoted delimiter: literal body
allowed('cat <<"EOF"\n${!t}\nEOF');
allowed('cat <<\\EOF\n${!t}\nEOF');
allowed('cat <<EOF\n\\${!t}\nEOF');       // escaped in the body
allowed("cat <<EOF\nit's fine\nEOF");     // a quote in an expanding body is literal

// --- several rules, heredoc, unrelated calls -----------------------------------
reason = denied('echo ===== && grep --include=*.md x .');
assert.ok(/Equals expansion/.test(reason) && /Glob in a flag value/.test(reason), 'reports every rule hit');

allowed('cat <<EOF\necho =====\ngrep --include=*.md x .\nEOF');
denied('cat <<EOF\nx\nEOF\necho =ls');       // zsh again after the terminator
denied('echo "$(echo =ls)"');             // a substitution inside quotes is zsh
allowed('echo "$(echo \'=ls\')"');
denied('echo =====\ncat <<EOF\ntext\nEOF');
denied('echo ===== <<<"seed"');

assert.strictEqual(run({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: {} }), null,
  'another tool is not this hook business');
assert.strictEqual(run(bash('')), null, 'no command, nothing to check');
assert.strictEqual(run({}), null, 'empty payload is silent');

console.log('zsh-wordsplit-guard expansion rules: all checks passed');
