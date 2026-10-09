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
//      fails with `==== not found`, and so does `[ a == b ]`.
//   2. A glob in a `--flag=value` word. The pattern is the whole word, so
//      `--include=*.md` matches no file even when `a.md` exists, and `nomatch`
//      aborts the command: `no matches found: --include=*.md`.
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
// Scope and the missing opt-out: docs/adr/0022-the-wordsplit-guard-also-flags-zsh-expansions.md,
// docs/adr/0023-the-wordsplit-guard-flags-indirect-expansion.md.
const { readBashInput, deny, maskedViews } = require('./scan');

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
// Rules match on a masked view; messages quote the command itself.
const quote = (start, length) => command.slice(start, start + length);

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
    // `--name=value` in word position.
    view: words,
    regex: /(^|[\s;&|(`])(--[A-Za-z0-9][\w-]*=)(\S*)/g,
    reason(m) {
      // `${…}` and `$name[…]` hold subscripts and modifiers, not globs.
      if (!/[*?[]/.test(m[3].replace(/\$\{[^}]*\}|\$[A-Za-z_]\w*\[[^\]]*\]/g, ''))) return null;
      const value = quote(m.index + m[1].length + m[2].length, m[3].length);
      return 'Glob in a flag value: `' + m[2] + value + '`. zsh matches the WHOLE ' +
        'word against file names, finds none, and aborts with `no matches ' +
        "found`. Quote the value: `" + m[2] + "'" + value + "'`.";
    },
  },
  {
    // A word starting with `=` and something after it. `=(cmd)` is zsh process
    // substitution, written on purpose.
    view: words,
    regex: /(^|[\s;&|(`])(=[^\s;&|()<>`]?[^\s;&|<>`]*)/g,
    reason(m) {
      if (m[2] === '=' || m[2][1] === '(') return null;
      const word = quote(m.index + m[1].length, m[2].length);
      const lead = word === '=='
        ? 'Inside `[ ]` or `test`, compare with a single `=`, or use `[[ ]]`. ' +
          "Elsewhere, quote it: `'=='`."
        : "Quote it: `'" + word + "'`. For the path of a command, write " +
          '`${commands[name]}`.';
      return 'Equals expansion: `' + word + '`. zsh replaces an unquoted word ' +
        'starting with `=` by the path of the command it names, or fails with ' +
        '`not found`. ' + lead;
    },
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
      return 'Parentheses in a parameter pattern: `' + quote(m.index, end - m.index) +
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

const reasons = [];
for (const rule of RULES) {
  for (const m of rule.view.matchAll(rule.regex)) {
    const reason = rule.reason(m);
    if (reason) { reasons.push(reason); break; }
  }
}

if (!reasons.length) process.exit(0);

deny('zsh-wordsplit-guard: the Bash tool runs zsh, which expands this ' +
  'differently from bash.\n' + reasons.map((r) => '- ' + r).join('\n'));
