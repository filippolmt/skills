#!/usr/bin/env node
// zsh-wordsplit-guard, expansion rules — the second PreToolUse hook on Bash,
// beside guard.js, which owns the `for x in $var` rule and its opt-out.
//
// The Bash tool runs zsh, and three of its expansions turn a word a bash-trained
// author meant literally into something else. Measured in the toolbox container
// (zsh 5.9, non-interactive, default options):
//
//   1. Equals expansion. An unquoted word starting with `=` expands to the path
//      of the command it names: `echo =ls` prints `/usr/bin/ls`, `echo =====`
//      fails with `==== not found`, and so does `[ a == b ]`. The same holds in
//      a `case` pattern and for an assignment value (`v==ls`), not for an
//      argument with `=` inside (`echo v==ls`).
//   2. A glob in a `--flag=value` word. The pattern is the whole word, so
//      `--include=*.md` matches no file even when `a.md` exists, and `nomatch`
//      aborts the command: `no matches found: --include=*.md`. A `case`
//      pattern generates no file names, so `--x=*)` there is no trap.
//   3. Parentheses in a `${v/pat/repl}` pattern. They are a glob group in zsh and
//      literal in bash, so `${b/(x, y)/X}` on "see (x, y)" gives "see (X)": a
//      wrong result, no error.
//
// A fourth form is bash syntax zsh lacks:
//
//   4. `${!…}`. `${!t}`, `${!T*}`, `${!arr[@]}`, `${!1}` and `${!@}` abort with
//      `bad substitution` once the commands before them have run; `${!#}`
//      gives `$!` instead of the last argument, no error.
//
// Rules 1 and 2 rewrite instead of denying when the word is plain literal text,
// so the call runs with no round trip: the rewrite gives bash's reading of it
// whenever bash's own glob matches no file. A word holding an expansion, a
// quote or anything outside LITERAL is still denied.
//
// Scope and the missing opt-out: docs/adr/0022-the-wordsplit-guard-also-flags-zsh-expansions.md,
// docs/adr/0023-the-wordsplit-guard-flags-indirect-expansion.md; the rewrite:
// docs/adr/0025-the-wordsplit-guard-rewrites-literal-words.md.
const { readBashInput, deny, rewrite, maskedViews } = require('./scan');

const input = readBashInput();
if (!input) process.exit(0);
const command = input.command;

const blankRun = (m) => m.replace(/[^\n]/g, ' ');
const { words: masked, patterns } = maskedViews(command);
// `[[ a == b ]]` and arithmetic (`(( a == b ))`, `$(( … ))`) read `==` as an
// operator, not a word.
const words = masked
  .replace(/\[\[[\s\S]*?\]\]/g, blankRun)
  .replace(/\(\((?:[^()]|\([^()]*\))*\)\)/g, blankRun);
// `case` patterns, blanked for rule 2: zsh generates no file names there.
// shortcut: a pattern holding `(` or `;` stays visible, so a glob flag in it
// is still denied; widen the regex if one shows up.
const flagWords = words.replace(/(\bcase\s+\S+\s+in\b|;;|;&|;\|)(\s*\(?)([^()\n;]*)\)/g,
  (m, lead, open, pattern) => lead + open + blankRun(pattern) + ')');
// Rules match on a masked view; messages quote the command itself.
const original = (start, length) => command.slice(start, start + length);
// Text bash takes literally whether quoted or not. Left out: `$` and backticks
// (expansions), quotes and `\`, `{` (bash brace-expands `*.{md,txt}` into two
// words), and `!`, `^`, `#`. `~` is in: after `=` in an argument neither
// shell expands it.
const LITERAL = /^[\w.*?[\]\/,:@%+=~-]+$/;
// The edit putting `to` in place of the text at `start`, or null unless that
// text is LITERAL and fully visible in the masked view (nothing quoted or
// escaped glued inside).
function literalEdit(start, length, to) {
  const text = original(start, length);
  if (text !== words.slice(start, start + length) || !LITERAL.test(text)) return null;
  return { start: start, length: length, from: text, to: to(text) };
}
// `${…}`, `$name[…]`, `$(…)` and backticks hold subscripts, modifiers and
// commands, not globs of the flag value.
const NOT_VALUE = /\$\{[^}]*\}|\$[A-Za-z_]\w*\[[^\]]*\]|\$\([^()]*\)|`[^`]*`/g;
// The value with each glob character zsh would match escaped: that keeps any
// expansion, quote or brace around it working, as the deny's hint.
function escapeGlobs(start, length) {
  const view = flagWords.slice(start, start + length).replace(NOT_VALUE, blankRun);
  let out = '';
  for (let i = 0; i < length; i++) out += (/[*?[]/.test(view[i]) ? '\\' : '') + command[start + i];
  return out;
}
// Whether the word at `at` is an assignment, where zsh expands a value starting
// with `=`: it follows only other assignments in its command, or is an argument
// of a declaration builtin.
function isAssignment(at) {
  const before = words.slice(0, at).split(/[;&|(`\n]/).pop().trim().split(/\s+/)
    .filter((w) => w && !/^(?:\{|!|then|do|else|time)$/.test(w));
  return before.every((w) => /^[A-Za-z_]\w*=/.test(w)) ||
    /^(?:export|typeset|local|declare|readonly|integer|float)$/.test(before[0]);
}

// What a parameter pattern holds, from `from` up to the `/` that starts the
// replacement (`stopAtSlash`) or the `}` that closes the expansion. Nested
// `${…}` and `$(…)` are skipped, and their text left out of `pattern`.
function patternAt(text, from, stopAtSlash) {
  let pattern = '';
  let depth = 0;
  let i = from;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === '$' && (text[i + 1] === '{' || text[i + 1] === '(')) { depth++; i++; continue; }
    if (depth && (ch === '}' || ch === ')')) { depth--; continue; }
    if (!depth && (ch === '}' || (stopAtSlash && ch === '/'))) break;
    if (!depth) pattern += ch;
  }
  return { pattern: pattern, end: i };
}

// Each rule scans one view and turns a match into a reason, or null to pass it.
const RULES = [
  {
    // `--name=value` in word position, the value up to an operator or a
    // parenthesis that is not part of a `$(…)` or backtick substitution in it.
    view: flagWords,
    regex: /(^|[\s;&|(`])(--[A-Za-z0-9][\w-]*=)((?:\$\([^()]*\)|`[^`]*`|[^\s;&|<>()`])*)/g,
    span: (m) => [m.index + m[1].length + m[2].length, m[3].length],
    reason(m, start, length) {
      const value = original(start, length);
      const escaped = escapeGlobs(start, length);
      if (escaped === value) return null;
      return 'Glob in a flag value: `' + m[2] + value + '`. zsh matches the WHOLE ' +
        'word against file names, finds none, and aborts with `no matches ' +
        'found`. Escape the glob: `' + m[2] + escaped + '`.';
    },
    rewrite: (m, start, length) => literalEdit(start, length, (text) => "'" + text + "'"),
  },
  {
    // A word starting with `=` and something after it, or an assignment value
    // starting with `=` (`NAME=` in group 2). The word stops at a parenthesis:
    // the `)` closing a `$(…)` around it is not part of it, and `=(cmd)`, zsh
    // process substitution written on purpose, matches as a lone `=`.
    view: words,
    regex: /(^|[\s;&|(`])([A-Za-z_]\w*=)?(=[^\s;&|()<>`]*)/g,
    span: (m) => [m.index + m[1].length + (m[2] || '').length, m[3].length],
    reason(m, start, length) {
      if (m[3] === '=' || (m[2] && !isAssignment(m.index + m[1].length))) return null;
      const word = original(start, length);
      const fix = /[*?[]/.test(word)
        ? 'Escape the `=` to keep the pattern, as a `case` branch wants: `\\' + word +
          "`; quote the word for the literal text: `'" + word + "'`."
        : 'Escape the `=`: `\\' + word + '`.';
      return 'Equals expansion: `' + word + '`. zsh replaces an unquoted word ' +
        'starting with `=` by the path of the command it names, or fails with ' +
        '`not found`. ' + fix + ' For the path of a command, write `${commands[name]}`.';
    },
    // Escaping the `=` alone is right in every position, a `case` pattern
    // included, once no glob follows it: zsh's `[ ]` and `test` accept `\==`.
    rewrite: (m, start, length) => (/[*?[]/.test(m[3]) ? null
      : literalEdit(start, length, (text) => '\\' + text)),
  },
  {
    // A pattern-taking modifier on a named parameter: `${v/`, `${v//`, `${v:/`,
    // `${v#`, `${v##`, `${v%`, `${v%%`. `${#v}`, `${=v}` and `${(f)v}` start
    // differently.
    view: patterns,
    regex: /\$\{[A-Za-z_]\w*(\/\/?|:\/|##?|%%?)/g,
    reason(m) {
      const at = m.index + m[0].length;
      const { pattern, end } = patternAt(patterns, at, m[1].endsWith('/'));
      // A parenthesis inside a bracket class (`[(]`) is literal: that is the
      // bracket form of the escape.
      const bare = pattern.replace(/\[\^?\]?[^\]]*\]/g, '');
      // `(a|b)` alternation and `(#…)` flags are zsh pattern syntax on purpose.
      if (!/[()]/.test(bare) || /\||\(#/.test(bare)) return null;
      return 'Parentheses in a parameter pattern: `' + original(m.index, end - m.index) +
        '`. zsh reads `(…)` as a glob group, so the parentheses themselves are ' +
        'never matched: a wrong result, no error. Escape each one (`\\(`, ' +
        '`\\)`), or do the replacement in python or sed.';
    },
  },
  {
    // bash's `${!…}`: indirection, name and key lists, last argument. `${!}`,
    // `${!-x}` and `${!:-x}` are `$!` in both shells.
    view: patterns,
    regex: /\$\{!(?:[\w@*$]|#\})/g,
    reason(m) {
      const { end } = patternAt(patterns, m.index + 2, false);
      // Unlike rule 3's pattern, the quoted form includes the closing `}`; an
      // unterminated one stops at the first blank and is quoted closed.
      const closed = patterns[end] === '}';
      const inner = closed
        ? command.slice(m.index + 3, end)
        : /^[^\s}]*/.exec(command.slice(m.index + 3))[0];
      const form = '${!' + inner + '}';
      const trap = (what) => what + ': `' + form + '`. It is bash syntax: zsh ' +
        'aborts with `bad substitution`. ';
      if (inner === '#') {
        return 'Last argument: `${!#}`. zsh expands it to `$!`, the PID of the ' +
          'last background job: a wrong result, no error. Write `${argv[-1]}`.';
      }
      if (/^[@*$]$/.test(inner)) {
        return 'Not a parameter: `' + form + '`. zsh aborts with `bad ' +
          'substitution`. Write `$!` for the PID of the last background job, ' +
          (inner === '$' ? '`$$` for the PID of the shell.' : '`"$@"` for the arguments.');
      }
      // bash's `@` keeps one word per name inside double quotes and `*` joins
      // them; zsh's `(@)` flag is the `@` and its absence the `*`.
      const keys = /^(\w+)\[([@*])\]$/.exec(inner);
      if (keys) {
        const [, name, each] = keys;
        const flags = each === '@' ? '@k' : 'k';
        return trap('Key list') + 'Write `${(' + flags + ')' + name + '}` for the ' +
          'keys of an associative array; for the indices of an array, loop with ' +
          '`for ((i = 1; i <= $#' + name + '; i++))`, zsh indices starting at 1.';
      }
      const prefix = /^(\w+)([@*])$/.exec(inner);
      if (prefix) {
        const [, start, each] = prefix;
        // `(o)` sorts the names, as bash does.
        const flags = each === '@' ? '@ok' : 'ok';
        return trap('Name list') + 'Write `${(' + flags + ')parameters[(I)' + start + '*]}`.';
      }
      // `(P)` takes the place of `!` and keeps any modifier: `${(P)t:-d}`.
      return trap('Indirect expansion') + 'Write `${(P)' + inner + '}`.';
    },
  },
];

// Every rewritable hit is collected; the first hit a rule cannot rewrite denies.
const reasons = [];
const edits = [];
for (const rule of RULES) {
  for (const m of rule.view.matchAll(rule.regex)) {
    const span = rule.span ? rule.span(m) : [];
    const reason = rule.reason(m, ...span);
    if (!reason) continue;
    const edit = rule.rewrite && rule.rewrite(m, ...span);
    if (edit) { edits.push(edit); continue; }
    reasons.push(reason);
    break;
  }
}

if (reasons.length) {
  // The edits are dropped: the retry gets them again.
  deny('zsh-wordsplit-guard: the Bash tool runs zsh, which expands this ' +
    'differently from bash.\n' + reasons.map((r) => '- ' + r).join('\n'));
} else if (edits.length) {
  let rewritten = command;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    rewritten = rewritten.slice(0, e.start) + e.to + rewritten.slice(e.start + e.length);
  }
  rewrite(input.toolInput, rewritten, 'zsh-wordsplit-guard rewrote ' +
    edits.reverse().map((e) => '`' + e.from + '` as `' + e.to + '`').join(', ') +
    ': the Bash tool runs zsh, which would otherwise expand them. The command ' +
    'ran with that quoting; write it yourself next time.');
}
