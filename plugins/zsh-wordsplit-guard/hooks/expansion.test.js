#!/usr/bin/env node
// Self-check for expansion.js. Run: node expansion.test.js
// The denied and rewritten commands fail or give a wrong result under zsh 5.9;
// the allowed ones are the nearby forms that run as written, including the
// correct rewrite of each denied one.
const assert = require('assert');
const { run, bash, denied, allowed, rewritten } = require('./testing').harness('expansion.js');
const rewrites = (command, want) => assert.strictEqual(rewritten(command), want);

// --- equals expansion ---------------------------------------------------------
rewrites('echo =====', 'echo \\=====');
rewrites('echo =ls', 'echo \\=ls');           // silently prints /usr/bin/ls
rewrites('echo foo =bar', 'echo foo \\=bar');
rewrites('[ "$a" == "$b" ] && echo same', '[ "$a" \\== "$b" ] && echo same'); // `==` is a word to `[`
rewrites('test a == b', 'test a \\== b');
rewrites('echo ok; echo ==', 'echo ok; echo \\==');
rewrites('case $v in =ab) echo y;; esac', 'case $v in \\=ab) echo y;; esac'); // patterns expand it too
rewrites('v==ls; echo $v', 'v=\\=ls; echo $v'); // an assignment value expands
rewrites('a=1 v==ls cmd', 'a=1 v=\\=ls cmd');
rewrites('export v==ls', 'export v=\\=ls');
let reason = denied('x=ls; echo =$x');      // an expansion: single quotes would kill it
assert.ok(/Escape the `=`: `\\=\$x`/.test(reason), 'names the escaped form');
assert.ok(/\$\{commands\[name\]\}/.test(reason), 'names the command-path form');
assert.ok(!/run the command again/.test(reason), 'no closing line restating the rewrite');
reason = denied('case $v in =*) echo y;; esac'); // a glob: `'=*'` would match only itself
assert.ok(/`\\=\*`/.test(reason) && /`'=\*'`/.test(reason), 'names the pattern and the literal form');
denied("echo =a'b'");                      // a quote glued on: not plain text

allowed("echo '====='");
allowed('echo "====="');
allowed('echo \\=====');
allowed('X=1 cmd');
allowed('echo a==b --x=y');
allowed('echo v==ls');                     // an argument, not an assignment
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
rewrites('grep -rn --include=*.md pattern .', "grep -rn --include='*.md' pattern .");
rewrites('grep -r --exclude-dir=node_* x .', "grep -r --exclude-dir='node_*' x .");
rewrites('rg --glob=*.ts foo', "rg --glob='*.ts' foo");
rewrites('git log --format=[%h] -1', "git log --format='[%h]' -1");
rewrites('ls --x=?', "ls --x='?'");
// A backslash escape before the word must not shift where the word is found.
rewrites('grep "a\\|b\\|c" --include=*.md .', "grep \"a\\|b\\|c\" --include='*.md' .");
rewrites('x a\\ b --include=*.md', "x a\\ b --include='*.md'");
rewrites('echo $(echo a\\ b) --x=*.md', "echo $(echo a\\ b) --x='*.md'");
rewrites('cat <<EOF\na\\b\nEOF\ngrep --include=*.md x .', "cat <<EOF\na\\b\nEOF\ngrep --include='*.md' x .");
rewrites('echo --x=*.md;echo ok', "echo --x='*.md';echo ok"); // the value stops at an operator
reason = denied('e=md; grep -rn --include=*.$e pattern .');
assert.ok(/--include=\\\*\.\$e`/.test(reason), 'names the escaped glob');
assert.ok(/no matches found/.test(reason), 'names the failure');
assert.ok(/`--x=\\\*\.\{md,txt\}`/.test(denied('echo --x=*.{md,txt}')), 'bash brace-expands it: escape, keep the braces');
rewrites('echo --x=~/*.md', "echo --x='~/*.md'"); // neither shell expands `~` after `=` here
denied('echo --x=*\\ y');                  // an escape glued on
denied('echo --x=`pwd`*');                  // a backtick substitution in the value
allowed('case $v in --x=* | y) echo;; esac'); // a `case` pattern generates no file names

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
rewrites('cat <<EOF\nnow $(echo =ls)\nEOF', 'cat <<EOF\nnow $(echo \\=ls)\nEOF'); // a substitution in the body is zsh
rewrites('cat <<EOF\n`grep --include=*.md x .`\nEOF', "cat <<EOF\n`grep --include='*.md' x .`\nEOF");
allowed("cat <<'EOF'\n$(echo =ls)\nEOF");   // a quoted delimiter: literal body
allowed('cat <<EOF\n"=ls" --include=*.md\nEOF'); // body text is not a word

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
assert.ok(/`\$\{\(ok\)parameters\[\(I\)T\*\]\}`/.test(reason), '`*` joins: no `@` flag');
reason = denied('echo "${!GIT_@}"');
assert.ok(/`\$\{\(@ok\)parameters\[\(I\)GIT_\*\]\}`/.test(reason), '`@` keeps words: `@` flag');
reason = denied('for k in "${!h[@]}"; do echo $k; done');
assert.ok(/^- Key list: /m.test(reason), 'labels the key list');
assert.ok(/`\$\{\(@k\)h\}`/.test(reason), 'keys: one word each, quoted or not');
assert.ok(/`for \(\(i = 1; i <= \$#h; i\+\+\)\)`/.test(reason), 'indices: an arithmetic loop');
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

// --- parameter transformation -------------------------------------------------
reason = denied('cat > out.txt <<EOF\nx\nEOF\necho ${v@Q}');
assert.ok(/^- Parameter transformation: `\$\{v@Q\}`\./m.test(reason), 'quotes the form');
assert.ok(/bad substitution/.test(reason), 'names the failure');
assert.ok(/Write `\$\{\(qq\)v\}`\.$/.test(reason), 'names the exact rewrite');
assert.ok(/`\$\{\(@qq\)a\}`/.test(denied('printf "%s\\n" "${a[@]@Q}"')), '`[@]` keeps words: `@` flag');
assert.ok(/`\$\{\(j: :\)\$\{\(@qq\)a\}\}`/.test(denied('echo "${a[*]@Q}"')), '`[*]`: quote each, then join');
assert.ok(/`\$\{\(@qq\)argv\}`/.test(denied('echo "${@@Q}"')), 'the arguments');
assert.ok(/`\$\{\(qq\)1\}`/.test(denied('echo ${1@Q}')), 'a positional parameter');
assert.ok(/`\$\{\(g::\)v\}`/.test(denied('echo "${v@E}"')), 'escapes');
assert.ok(/`\$\{\(U\)v\}`/.test(denied('echo ${v@U}')), 'upper case');
assert.ok(/`\$\{\(L\)v\}`/.test(denied('echo ${v@L}')), 'lower case');
assert.ok(/`\$\{\(U\)v\[1\]\}\$\{v\[2,-1\]\}`/.test(denied('echo ${v@u}')), 'first letter only, not `(C)`');
reason = denied('echo "${PS@P}"');
assert.ok(/`\$\{\(%\)PS\}`/.test(reason) && /`%n`/.test(reason), 'prompt: names the escapes that differ');
for (const op of ['A', 'a', 'K', 'k']) {
  assert.ok(/python or sed/.test(denied('echo ${v@' + op + '}')), op + ': no zsh flag');
}
assert.ok(/python or sed/.test(denied('echo ${a[@]@u}')), 'u on an array: no single flag');
reason = denied('echo ${v@x} ${v@}');
assert.ok(/^- Not a transformation: `\$\{v@x\}`\./m.test(reason), 'an unknown letter fails in bash too');
assert.ok(/Not a transformation/.test(denied('echo ${#v@Q}')), 'a length is no transformation');
denied('cat <<EOF\n${v@Q}\nEOF');          // an unquoted heredoc body expands

allowed("echo '${v@Q}'");
allowed('echo \\${v@Q}');
allowed("cat <<'EOF'\n${v@Q}\nEOF");
allowed('echo ${(qq)v} "${a[@]}" "${@}" ${#@} $v@Q user@host ${v}@x');

// --- several rules, heredoc, unrelated calls -----------------------------------
rewrites('echo ===== && grep --include=*.md x . && echo =ls',
  "echo \\===== && grep --include='*.md' x . && echo \\=ls"); // every hit of every rule
reason = denied('echo ===== && grep --include=*.$e x . && echo ${!t}');
assert.ok(/Glob in a flag value/.test(reason) && /Indirect expansion/.test(reason), 'reports every rule hit');
assert.ok(!/Equals expansion/.test(reason), 'a rewritable hit is not a deny reason');

allowed('cat <<EOF\necho =====\ngrep --include=*.md x .\nEOF');
rewrites('cat <<EOF\nx\nEOF\necho =ls', 'cat <<EOF\nx\nEOF\necho \\=ls'); // zsh again after the terminator
rewrites('echo "$(echo =ls)"', 'echo "$(echo \\=ls)"'); // a substitution inside quotes is zsh
rewrites('echo =====\ncat <<EOF\ntext\nEOF', 'echo \\=====\ncat <<EOF\ntext\nEOF');
rewrites('echo ===== <<<"seed"', 'echo \\===== <<<"seed"');

assert.strictEqual(run({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: {} }), null,
  'another tool is not this hook business');
assert.strictEqual(run(bash('')), null, 'no command, nothing to check');
assert.strictEqual(run({}), null, 'empty payload is silent');

console.log('zsh-wordsplit-guard expansion rules: all checks passed');
