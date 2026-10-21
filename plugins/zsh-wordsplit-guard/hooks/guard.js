#!/usr/bin/env node
// zsh-wordsplit-guard, loop rule — a PreToolUse hook on the Bash tool, beside
// expansion.js, which flags three other zsh expansions.
//
// The Bash tool runs zsh, where `SH_WORD_SPLIT` is off: parameter expansion is
// NOT word-split, while command substitution is. So `v="a b c"; for x in $v`
// runs the body ONCE with x set to the whole string, and `for f in $(ls)` runs
// it per file. Measured in the toolbox container (zsh 5.9, non-interactive).
//
// The failure mode is what earns a guard: the wrong form does not error. It
// passes any check whose sample input happens to have one element and goes
// wrong from the second on.
//
// Scope is deliberately one construct — `for NAME in <expansion>` — because
// that is where the intent is BY DEFINITION to iterate over several elements,
// so non-split is always a bug. Unquoted `$var` in argument position (`grep
// $flags f`) is left alone: it is usually a single word and correct, and denying
// it would only teach ALLOW_ZSH_NOSPLIT=1, which kills the `for` check too.
// The one argument-position case in scope is the loop variable of a list of
// quoted multi-word literals, where the source itself proves several words were
// meant (docs/adr/0027-the-wordsplit-guard-flags-multi-word-loop-items.md).
// Outside loops, one more shape proves it from source: a quoted multi-word
// value run as a command, `DC="docker compose"; $DC ps`
// (docs/adr/0031-the-wordsplit-guard-flags-a-stored-command.md).
//
// Deny rather than warn: an advisory arrives after the wrong output is already
// in context, and the construct is narrow enough that a hit is almost always a
// real bug. Flipping to `"ask"` is a one-line change if false positives show up.
const { readBashInput, deny, maskedViews } = require('./scan');

const NOSPLIT_OPT_OUT = /\[nosplit\]/i;
// Explicit values only: `ALLOW_ZSH_NOSPLIT=0` must mean off, not "non-empty
// string, therefore on".
const ON = new Set(['1', 'true', 'yes']);

// A `for NAME in <list>`, list ending at `;` or newline (zsh needs one before `do`).
const FOR_HEADER = /\bfor\s+([A-Za-z_]\w*)\s+in\s+([^\n;]*)/g;
// One word of a `for` list. `${...}` is atomic, so a modifier holding spaces
// (`${v:-a b c}`) stays one word.
const WORD = /(?:\$\{[^}]*\}|[^\s])+/g;
// A non-splitting expansion: `$var`, `${var}`, or a braced form carrying a
// modifier (`${v:-a b c}`, `${v#p}`, `${v%x}`, `${v/a/b}`). Excluded by
// construction: `$1`, `$@`, `$*`, `$#` (positionals: correct, or split anyway),
// `${=v}` and `${(f)v}` (explicit splits), `${v[@]}` (an array expansion yields
// several words too).
const NONSPLIT_EXPANSION = /\$(?:\{([A-Za-z_]\w*)(?:[:#%/][^}]*)?\}|([A-Za-z_]\w*)(?![\w[]))/;
// Text around the expansion that makes the word harmless — see
// docs/adr/0005-what-the-wordsplit-guard-flags.md. A glob metacharacter yields
// several words whatever `SH_WORD_SPLIT` says (`$D/*.log`), and a path
// separator marks a word built to BE one word (`$D/a.log`). Anything else glued
// on — `$v,`, `$v.log`, `${v}x`, `$v$w` — still runs the body once, so it is
// still a hit.
const HARMLESS_AROUND = /[*?[/]/;
const input = readBashInput();
const optedOut =
  ON.has(String(process.env.ALLOW_ZSH_NOSPLIT || '').toLowerCase()) ||
  NOSPLIT_OPT_OUT.test((input || {}).description || '');

if (!input || optedOut) process.exit(0);

// The masked view (scan.js) already drops what zsh does not run here: quoted
// text, so a header that is only text (`echo "for x in $v"`) and the correct
// forms `"$v"` and `"${a[@]}"` are gone, a `#` comment, and a heredoc body. On
// top of it, a command substitution is blanked: `$(cmd)` is a splitting form.
// The cost is honest and one-sided: a real loop nested inside a quoted payload
// is invisible too, so `bash -c '... for x in $v ...'` — which does run under a
// shell that splits — needs no special case, and `zsh -c '…'` slips through
// with it. False negative over a wrong deny on the critical path.
const words = maskedViews(input.command).words;
const scannable = words
  .replace(/\$\((?:[^()]|\([^()]*\))*\)/g, ' ')
  .replace(/`[^`]*`/g, ' ');

let hit = null;
for (const header of scannable.matchAll(FOR_HEADER)) {
  const found = (header[2].match(WORD) || [])
    .filter((word) => !HARMLESS_AROUND.test(word.replace(/\$\{[^}]*\}/g, '')))
    .map((word) => NONSPLIT_EXPANSION.exec(word))
    .find(Boolean);
  if (!found) continue;
  const name = found[1] || found[2];
  // `a=(x y); for i in $a` is fine: an array expands to several words even with
  // SH_WORD_SPLIT off. Only what was assigned BEFORE this loop can be one.
  if (new RegExp('(?:^|[;&|(\\s])' + name + '=\\(').test(scannable.slice(0, header.index))) continue;
  hit = { expansion: found[0], name: name, header: header[0].trim() };
  break;
}

// Second shape (docs/adr/0027): `for c in "a.py /x" "b.py /y"; do python3 $c`.
// A quoted literal holding whitespace in the list exists only to be split again
// in the body, so an unquoted `$c` / `${c}` there is meant as several words and
// gets one. The list's quotes are blanked in the masked view, so they are read
// from the raw command at the same offsets; the body is read in `words`, where
// `"$c"` is already gone. Substitutions stay visible: a loop inside `$(…)` is zsh's.
// `[[ … ]]`, an assignment value and a `case` word never split, in bash either,
// so a use there is one word by intent; `eval` parses its arguments again, which
// splits them. zsh's short form `for c (…)` is read too.
const ITEM_HEADER = /\bfor\s+([A-Za-z_]\w*)\s*(?:\s+in\s+([^\n;]*)|\(([^)\n]*)\))/g;
// `do` and `done` in command position: the body is the text up to the `done`
// that closes this loop's `do`, past any loop nested in it.
// shortcut: a short-form loop with no `do` (`for c (…) { … }`) is read to the end
// of the command; bound it by the `}` or the command if a false positive shows up.
const DO_DONE = /(?:^|[;&|\n)])\s*(do|done)(?!\w)/g;

function bodyOf(text) {
  let depth = 0;
  for (const keyword of text.matchAll(DO_DONE)) {
    depth += keyword[1] === 'do' ? 1 : -1;
    if (depth === 0) return text.slice(0, keyword.index);
  }
  return text;
}

let itemHit = null;
if (!hit) {
  for (const header of words.matchAll(ITEM_HEADER)) {
    const end = header.index + header[0].length;
    const listText = header[2] !== undefined ? header[2] : header[3];
    const listEnd = header[2] !== undefined ? end : end - 1;
    // A substitution's quoted words are its command's arguments, not list items:
    // each span the masked view finds, where its own quotes are gone, becomes a
    // `$`, so a quoted word around it reads as not literal. A span the list cut
    // at a `;` runs to the list's end.
    const list = [...listText.matchAll(/\$\((?:[^()]|\([^()]*(?:\)|$))*(?:\)|$)|`[^`]*(?:`|$)/g)].reduceRight(
      (text, s) => text.slice(0, s.index) + '$' + text.slice(s.index + s[0].length),
      input.command.slice(listEnd - listText.length, listEnd));
    const quoted = list.match(/"(?:[^"\\]|\\.)*"|'[^']*'/g) || [];
    if (!quoted.some((word) => /\s/.test(word) && !/^"[\s\S]*[$`\\]/.test(word))) continue;
    const name = header[1];
    const body = bodyOf(words.slice(end)).replace(/\[\[[\s\S]*?\]\]/g, ' ');
    // `$c`, `${c}` or a braced modifier (`${c:-x}`, `${c%.py}`), as NONSPLIT_EXPANSION.
    const use = new RegExp('(?<![=\\w])(?<!\\bcase\\s+)(?<!\\beval\\s[^;&|\\n]*)\\$(?:' + name +
      '(?![\\w[])|\\{' + name + '(?:[:#%/][^}]*)?\\})').exec(body);
    if (use) { itemHit = { expansion: use[0], name: name, header: header[0].trim() }; break; }
  }
}

// Third shape (docs/adr/0031): a stored command, `DC="docker compose -f a.yml";
// $DC build`. zsh runs the whole value as one command name. The assignment's
// value is quoted, so it is read from the raw command; whitespace counts only
// outside an expansion, where the source shows it. The use is read in `words`:
// an unquoted `$DC` / `${DC}` as the first word of a command, past any
// assignment prefix, reserved word or precommand modifier.
// An assignment as a command or its prefix, a declaration builtin's included:
// `echo DC="a b"` is an argument. Quoted values are blank in `words`.
const ASSIGNMENT_AT = '(?<=(?:^|[;&|({\\n])\\s*(?:(?:export|local|typeset|declare|readonly)' +
  '\\s+(?:-\\w+\\s+)*)?(?:[A-Za-z_]\\w*=[^\\s;&|]*\\s+)*)';
const COMMAND_START = '(?:^|[;&|({\\n])\\s*(?:(?:then|do|else|elif|if|while|until|!|' +
  'time|exec|nohup|command|noglob|sudo|env)\\s+|[A-Za-z_]\\w*=[^\\s;&|]*\\s+)*';
let storedHit = null;
if (!hit && !itemHit) {
  // `(( $n ))` is arithmetic, not a command.
  const commands = words.replace(/\(\((?:[^()]|\([^()]*\))*\)\)/g, (m) => m.replace(/[^\n]/g, ' '));
  for (const a of commands.matchAll(new RegExp(ASSIGNMENT_AT + '([A-Za-z_]\\w*)=', 'g'))) {
    const at = a.index + a[0].length;
    const value = /^'[^']*'|^"(?:[^"\\]|\\.)*"/.exec(input.command.slice(at));
    if (!value || !/\s/.test(value[0].replace(/\$\{[^}]*\}|\$\([^)]*\)|`[^`]*`|\$\w+/g, ''))) continue;
    const name = a[1];
    const rest = commands.slice(at + value[0].length);
    const use = new RegExp(COMMAND_START + '(\\$(?:' + name + '(?![\\w[])|\\{' + name + '\\}))').exec(rest);
    // A later assignment, `DC=ls` or `DC=(docker compose)`, is what the use reads.
    if (!use || new RegExp(ASSIGNMENT_AT + name + '=').test(rest.slice(0, use.index))) continue;
    storedHit = { name: name, value: value[0], expansion: use[1] };
    break;
  }
}

const OPT_OUT = 'Deliberate non-split: [nosplit] in the description, or ' +
  'ALLOW_ZSH_NOSPLIT=1 for the session.';

if (itemHit) {
  const { name } = itemHit;
  deny(
    'zsh-wordsplit-guard: silent non-split. `' + itemHit.header + '` hands the body ' +
    'each quoted item as ONE word, and `' + itemHit.expansion + '` unquoted keeps it ' +
    'one word: the Bash tool runs zsh, where parameter expansion is not ' +
    'word-split. Rewrite as one of:\n' +
    '  - `${=' + name + '}` — split on IFS\n' +
    '  - one item per loop word, the shared arguments in the body: ' +
    '`for ' + name + ' in a b; do cmd "$' + name + '" arg; done`\n' +
    '  - several loop variables, one per word of an item (zsh only): ' +
    '`for ' + name + ' arg in a x b y; do cmd "$' + name + '" "$arg"; done`\n' +
    OPT_OUT);
  process.exit(0);
}

if (storedHit) {
  const { name } = storedHit;
  // bash splits the value into literal words; copied unquoted into a function
  // or an array, a `<`, `|` or glob would become syntax, so only plain text is.
  // A word starting with `=` or `~` would expand there too.
  const value = storedHit.value.slice(1, -1);
  const literalWords = /^[\w\s.\/=:,@%+~$-]*$/.test(value) && !/(?:^|\s)[=~]/.test(value) ? value : '…';
  const fn = name.toLowerCase();
  // `git() { git … }` would call itself: `command` reaches the real one.
  const body = literalWords.split(/\s/)[0] === fn ? 'command ' + literalWords : literalWords;
  deny(
    'zsh-wordsplit-guard: stored command. `' + name + '=' + storedHit.value + '` then `' +
    storedHit.expansion + ' …` runs the whole value as ONE command name: the Bash ' +
    'tool runs zsh, where parameter expansion is not word-split, so it fails with ' +
    '`command not found`. Rewrite as one of:\n' +
    '  - a function: `' + fn + '() { ' + body + ' "$@"; }`, then `' + fn + ' …`\n' +
    '  - an array: `' + name + '=(' + literalWords + ')`, then `"${' + name + '[@]}" …`\n' +
    '  - `${=' + name + '} …` — split on IFS\n' +
    OPT_OUT);
  process.exit(0);
}

if (!hit) process.exit(0);

deny(
  'zsh-wordsplit-guard: silent non-split. `' + hit.header + '` iterates ONCE ' +
  'over the whole string: the Bash tool runs zsh, where parameter expansion ' +
  'is not word-split, so `' + hit.expansion + '` stays one word. No error — a ' +
  'wrong result from the second element on. Rewrite as one of:\n' +
  '  - `${=' + hit.name + '}` — split on IFS\n' +
  '  - `${(f)' + hit.name + '}` — split per line (safe with paths containing spaces)\n' +
  '  - `arr=(...)` then `for x in "${arr[@]}"` — for values you build yourself\n' +
  '  - a literal list, or `$(cmd)` directly, which does split in zsh\n' +
  'Keep the split at the call site: `setopt shwordsplit` would change every ' +
  'later expansion in that shell. ' + OPT_OUT);
