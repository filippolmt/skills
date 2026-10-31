#!/usr/bin/env node
// Self-check for command.js. Run: node command.test.js
// The denied commands fail under zsh with `command not found`; the allowed ones
// run as written, or read a value the rule cannot see.
const assert = require('assert');
const { run, bash, denied, allowed, argumentContexts } = require('./testing').harness('command.js');

let reason = denied('DCF="docker compose -f a.yml -f b.yml"; $DCF build nginx');
assert.ok(/^zsh-wordsplit-guard: stored command\. /.test(reason), 'names the trap');
assert.ok(/`run_dcf\(\) \{ docker compose -f a\.yml -f b\.yml "\$@"; \}`/.test(reason), 'names the function');
assert.ok(/`DCF=\(docker compose -f a\.yml -f b\.yml\)`, then `"\$\{DCF\[@\]\}" …`/.test(reason), 'names the array');
assert.ok(/`\$\{=DCF\} …`/.test(reason) && /\[nosplit\]/.test(reason), 'names the split and the opt-out');
reason = denied('P="printf <%s>"; $P a');                     // a redirection if unquoted
assert.ok(/`run_p\(\) \{ … "\$@"; \}`/.test(reason) && /`P=\(…\)`/.test(reason), 'no syntax copied');
for (const value of ['echo $HOME', 'echo ${HOME}', 'echo $(pwd)', 'echo `pwd`']) {
  for (const wrap of [s => s, s => 'out=$(' + s + ')', s => 'echo "$(' + s + ')"', s => 'cat <<EOF\n$(' + s + ')\nEOF']) {
    const repair = denied(wrap("DC='" + value + "'; $DC"));
    assert.ok(repair.includes('run_dc() { … "$@"; }') && repair.includes('DC=(…)'), 'expansions are not executable repair text');
    assert.ok(repair.includes('${=DC}'), 'explicit splitting remains safe');
  }
}
denied('DC="echo hi"\n${DC} there');                         // braced, after a newline
reason = denied('GIT="git -C /tmp"; $GIT log');
assert.ok(/`run_git\(\) \{ git -C \/tmp "\$@"; \}`/.test(reason), 'the function never shadows the command');
assert.ok(/`run_d\(\) \{ … "\$@"; \}`/.test(denied('D="foo =bar ~/x"; $D')), 'no `=` or `~` word copied');
denied('cat <<EOF\n$(DC="docker compose"; $DC ps)\nEOF');   // a substitution in a heredoc body
denied("DC='echo hi'; true && $DC there");                   // single quotes, after &&
denied('DC="echo hi"; ls | $DC; false || $DC');
denied('export DC="docker compose"; if true; then $DC ps; fi');
denied('local DC="docker compose"; for s in a b; do $DC up $s; done'); // the loop rule passes; this one does not
denied('DC="docker compose"; { $DC ps; }');
denied('DC="docker compose"; ( $DC ps )');
denied('DC="docker compose"; X=1 $DC ps');                   // after an assignment prefix
denied('DC="docker compose"; sudo $DC ps; time $DC ps');      // after a precommand modifier
denied('F=a.yml; DC="docker compose -f $F"; $DC ps');          // a space outside the expansion
denied('x=$(DC="docker compose"; $DC ps)');                   // inside a substitution
denied('echo "$(DC="docker compose"; $DC ps)"');

allowed('CMD=ls; $CMD -la');                                  // one word: correct
denied('DC="docker compose"; echo $DC | wc -l');              // multi-word argument, consumed
allowed('DC="docker compose"; "$DC" ps');                     // quoted: one word in bash too
allowed('DC="docker compose"; ${=DC} ps');                    // explicit split
allowed('DC=(docker compose); "${DC[@]}" ps');                // an array
allowed('dc() { docker compose "$@"; }; dc ps');
allowed('$DC ps; DC="docker compose"');                     // used before it is assigned
allowed('DC="docker compose"; DC=ls; $DC');                   // reassigned before the use
allowed('DC="docker compose"; DC=(docker compose); $DC ps');  // an array: several words
allowed('N="1 + 1"; (( $N ))');                              // arithmetic, not a command
allowed('echo DC="a b"; $DC');                               // an argument, not an assignment
denied('DC="docker compose"; cmd do $DC');                    // a keyword as an argument
allowed('DC="docker compose"; [[ -n $DC ]] && echo set');
allowed('DC="docker compose"; x=$DC; case $DC in d*) echo d;; esac');
allowed('DC="$HOME/bin"; $DC/tool');                          // no space outside the expansion
allowed('DC=$(which docker) ; $DC ps');                       // unquoted: word count unknown
allowed("sh -c 'DC=\"docker compose\"; $DC ps'");            // single-quoted: another shell
allowed('cat <<EOF\nDC="docker compose"\n$DC ps\nEOF');      // heredoc text
allowed('DC="docker compose"; $DC ps', { description: 'deliberate [nosplit]' });
assert.strictEqual(run(bash('DC="a b"; $DC'), { ALLOW_ZSH_NOSPLIT: '1' }), null, 'session opt-out');
reason = denied('EXEC="docker exec -it c"; $EXEC sh');
assert.ok(/`run_exec\(\) \{/.test(reason), 'no builtin shadowed');
denied('DC="docker compose"; sudo -E $DC ps');               // a modifier's options
denied('DC="docker compose"; sudo -u root -E $DC ps');
denied('DC="docker compose"; env -i -u HOME $DC ps; exec -a x $DC ps; time -p $DC ps');
allowed('DC="docker compose" $DC ps');                       // a prefix: $DC reads the old value
allowed('DC="docker compose" make; $DC ps');                 // set for `make` only
denied('DC="docker compose"; sudo -E ls $DC');               // an argument of the command sudo runs
allowed("DC='docker compose'; $DC ps", { description: 'deliberate [NOSPLIT]' });

assert.strictEqual(run({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: {} }), null,
  'another tool is not this hook business');
assert.strictEqual(run({}), null, 'empty payload is silent');

reason = denied("files=$(git status --porcelain | awk '{print $2}') && git add -A -- $files && git commit -F - -- $files");
assert.ok(/silent non-split/.test(reason), 'names the argument trap');
assert.ok(reason.includes('${(f)files}') && reason.includes('${=files}') &&
  reason.includes('"${files[@]}"') && reason.includes('[nosplit]'), 'names line, IFS, array and opt-out');
for (const [check, setup, argument] of [
  [denied, 'files="$(printf \'a\\nb\')"', '${files}'],
  [denied, 'files="$(printf "%s\\n" a b)"', '$files'],
  [denied, 'files="$(printf "%s\\n" "$(echo a)" b)"', '$files'],
  [denied, 'files=$(printf "%s\\n" "$(echo a)" b)', '$files'],
  [denied, 'files=`printf "a\\nb"`', '$files'],
  [denied, "files='a b'", '${files}'],
  [denied, 'export files=$(printf "a\\nb")', '$files'],
  [denied, 'files="a\nb"', '$files'],
  [denied, 'files="a b"; files=one true', '$files'],
  [denied, 'files="a b"; files="one" true', '$files'],
  [denied, 'files="a b"', '$files>&1'],
  [denied, 'files="a b"', '$files</dev/null'],
  [allowed, 'files=$(echo a)', '"$files"'],
  [allowed, 'files=$(echo a)', '${=files}'],
  [allowed, 'files=$(echo a)', '${(f)files}'],
  [allowed, 'files=(a b)', '"${files[@]}"'],
  [allowed, 'files=$(echo a); files=one', '$files'],
  [allowed, 'files=$(echo a) cmd', '$files'],
  [allowed, 'echo files="a b"', '$files'],
  [allowed, 'files="one"', '$files'],
  [allowed, 'files="a b"', '$files_extra'],
  [allowed, 'files="a b"', '${files[1]}'],
  [allowed, 'files="a b"', '$files[1]'],
]) argumentContexts(check, setup, argument);
allowed('files=$(echo a); x=$files; [[ -n $files ]]; case $files in a) :;; esac');
allowed('files=$(echo a); export x=$files; eval "echo" $files');
allowed('files="a b"; if eval $files; then :; fi');
allowed('files="a b"; command eval $files');
allowed('files=$(echo a); cmd $files', { description: '[nosplit]' });
assert.strictEqual(run(bash('files=$(echo a); cmd $files'), { ALLOW_ZSH_NOSPLIT: '1' }), null);
allowed("files='$(echo a)'; cmd $files");
allowed('files=$(echo a); cat <<EOF\n$files\nEOF');
allowed("sh -c 'files=$(echo a); cmd $files'");

denied("if true; then files=$(printf 'a\\nb'); printf '<%s>' $files; fi");
denied('files="a b"; printf "<%s>" ${unused} $files');
denied('files="a b"; cmd done $files');
denied('for x in a; do files="a b"; cmd $files; done');
denied('if false; then :; else files="a b"; cmd $files; fi');
denied('files="a b"; if true; then files=one true; cmd $files; fi');
allowed('files="a b"; if true; then files=one; cmd $files; fi');
allowed('echo then files="a b"; cmd $files');
allowed('files="a b"; eval ${unused} $files');
allowed('files="a b"; eval ${unused:-x|y} $files');

// echo/print to the tool output: zsh differs from bash only in whitespace (#570).
allowed('cd repo && sha=$(git rev-parse HEAD) && echo $sha && glab mr merge 627 --sha "$sha" --yes');
allowed('v=$(cmd) && echo $v; print -r -- $v');
denied('v=$(cmd) && rm $v');
allowed('v=$(cmd) && echo $v || echo none');                  // || is not a pipe
denied('v=$(cmd); echo $v > out.txt');                        // a consumer reads the lines
denied('v=$(cmd); echo $v |& wc -l');
denied('v=$(cmd); x=$(true; echo $v)');
denied('v=$(cmd); x=`echo $v; true`');
denied('v=$(cmd); diff <(echo $v) f');
denied('v=$(cmd); tee >(echo $v) </dev/null');
allowed('v=$(cmd); echo -n $v; f() { echo $v; }');
denied('v=$(cmd); x="$(echo $v)"');
denied('v=$(cmd); cat <<EOF\n$(echo $v)\nEOF');
denied('v=$(cmd); echo $v &>f');
denied('v=$(cmd); { echo $v; } | wc -l');                   // a group's output: conservative
denied('v=$(cmd); if true; then echo $v; fi | wc -l');
denied('v=$(cmd); for i in 1; do echo $v; done > f');
allowed('v=$(cmd); echo ${v} && echo ${v:-none}');
allowed('v=$(cmd); echo $v 2>&1; echo $v 2>/dev/null; echo $v >&2'); // stderr: still the tool output
allowed('v=$(cmd); echo "$(date)" $v; print -r -- `date` $v');
denied('v=$(cmd); echo $v 1>f');
denied('v=$(cmd); echo $v >>f');
denied('v=$(cmd); echo $v 2>>e >f');
denied('v=$(cmd); echo $v >| f');
// A group's output goes where its closing word sends it.
allowed('v=$(cmd); ( echo $v ); { echo $v; }; if true; then echo $v; fi');
allowed('for i in $(seq 3); do s=$(cmd); case $s in run|wait) sleep 1;; *) echo $s; break;; esac; done');
allowed('v=$(cmd); while true; do echo $v; done 2>/dev/null');
denied('v=$(cmd); ( echo $v ) | wc -l');
denied('v=$(cmd); { { echo $v; }; } | wc -l');
denied('v=$(cmd); case x in x) echo $v;; esac > f');
denied('v=$(cmd); if echo $v | grep -q a; then :; fi');

console.log('zsh-wordsplit-guard stored-value rules: all checks passed');
