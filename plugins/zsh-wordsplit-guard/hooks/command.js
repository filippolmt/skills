#!/usr/bin/env node
// zsh-wordsplit-guard, stored-value rules — a PreToolUse hook on Bash, beside
// guard.js (loops) and expansion.js (other zsh expansions).
//
// `DC="docker compose -f a.yml"; $DC build`: bash splits the value into a
// command and its arguments, zsh looks the whole value up as one command name
// and fails with `command not found`. A quoted value holding whitespace, run as
// a command, exists only to be split again: the source proves the intent, as
// for guard.js's loop items. Scope, what is not read and the measurement:
// docs/adr/0031-the-wordsplit-guard-flags-a-stored-command.md. Stored arguments
// also cover values from substitutions: docs/adr/0032-the-wordsplit-guard-flags-stored-arguments-and-history-modifiers.md.
const { readBashInput, deny, maskedViews, maskNonSplitting, noSplitOptedOut, NOSPLIT_OPT_OUT_HINT } = require('./scan');

const input = readBashInput();
if (!input || noSplitOptedOut(input)) process.exit(0);

// Quoted text is blank in `words`, so assignment values are read from the raw
// command at the same offsets. `(( $n ))` is arithmetic, not a command.
const words = maskNonSplitting(maskedViews(input.command).words);

// Where a command starts, and an assignment word, whose value stops at an operator.
const START = '(?:^|[;&|({\\n])\\s*';
const ASSIGN = '[A-Za-z_]\\w*=[^\\s;&|]*\\s+';
const RESERVED = '(?:then|do|else|elif|if|while|until|!)\\s+';
// An assignment that is a command of its own, a declaration builtin's
// included: one in front of a command (`DC="a b" cmd`) sets it for that
// command only, and `echo DC="a b"` is an argument.
const ASSIGNMENT_AT = '(?<=' + START + '(?:' + RESERVED + ')*' +
  '(?:(?:export|local|typeset|declare|readonly)' +
  '\\s+(?:-\\w+\\s+)*)?(?:' + ASSIGN + ')*)';
const ONLY_ASSIGNMENTS = /^(?:\s+[A-Za-z_]\w*=[^\s;&|]*)*\s*(?:[;&|\n)}]|$)/;
// The first word of a command, past reserved words, assignment prefixes and
// precommand modifiers with their options: the ones taking an argument are
// named (`sudo -u root`, `env -u NAME`, `exec -a name`).
const MODIFIER = '(?:nohup|noglob|' +
  'time(?:\\s+-\\w+)*|command(?:\\s+-\\w+)*|' +
  'exec(?:\\s+-a\\s+\\S+|\\s+-\\w+)*|env(?:\\s+-u\\s+\\S+|\\s+-\\w+)*|' +
  'sudo(?:\\s+-[ugUCDhprtT]\\s+\\S+|\\s+-\\w+)*)\\s+';
const COMMAND_START = START + '(?:' + RESERVED + '|' + MODIFIER + '|' + ASSIGN + ')*';

// Quoted scalar, or an unquoted substitution. Count parentheses in the masked
// view so quoted `)` and nested substitutions keep the assignment's boundary.
function valueAt(at) {
  const text = input.command.slice(at);
  if (text[0] === "'") return (/^'[^']*'/.exec(text) || [null])[0];
  const substitutionEnd = (start) => {
    if (words[start] === '`') return words.indexOf('`', start + 1);
    let depth = 1;
    for (let i = start + 2; i < words.length; i++) {
      if (words[i] === '(') depth++;
      if (words[i] === ')' && --depth === 0) return i;
    }
    return -1;
  };
  for (let i = at + (text[0] === '"' ? 1 : 0); i < words.length; i++) {
    if (input.command[i] === '\\') { i++; continue; }
    if (words.slice(i, i + 2) === '$(' || words[i] === '`') {
      i = substitutionEnd(i);
      if (i === -1) return null;
      if (text[0] !== '"') return input.command.slice(at, i + 1);
    } else if (text[0] === '"' && input.command[i] === '"') {
      return input.command.slice(at, i + 1);
    } else if (text[0] !== '"') return null;
  }
  return null;
}

// shortcut: assignment tracking ignores subshell scope; use a shell parser if scope-related false positives appear.
function reassignedBefore(name, from, to) {
  const between = words.slice(from, to);
  for (const a of between.matchAll(new RegExp(ASSIGNMENT_AT + name + '=', 'g'))) {
    const at = from + a.index + a[0].length;
    const value = valueAt(at) || /^(?:\((?:[^()]|\([^()]*\))*\)|[^\s;&|]*)/.exec(words.slice(at))[0];
    if (ONLY_ASSIGNMENTS.test(words.slice(at + value.length))) return true;
  }
  return false;
}

// Whether `text`, following an argument or a group's closing word, pipes or
// redirects stdout: `>f`, `1>f`, `>>f`, `&>f`, `| x`; not `2>f`, `2>&1`, `>&2`
// or `||`, which leave stdout on the tool output.
function sendsStdoutAway(text) {
  // Up to the command's end; `&>` and `>&` are redirections, not separators.
  const rest = /^(?:[^;&|\n)}`]|&(?=>)|(?<=>)&)*/.exec(text)[0];
  const next = text.slice(rest.length);
  return /(?<![\d>&])(?:1?>>?|&>>?)(?!&)/.test(rest) || (next[0] === '|' && next[1] !== '|');
}

// What opens or closes a group: substitutions, parentheses, braces, backticks,
// and compound keywords in command position.
const GROUP_TOKEN = /\$\(|[<>]\(|[(){}`]|(?<=(?:^|[;&|\n(){]|\b(?:then|do|else|elif))\s*)(?:if|while|until|for|select|case|fi|done|esac)\b/g;

// Whether the argument `found` hands its stdout to a consumer: a pipe or
// redirection after it, an enclosing substitution, or an enclosing group whose
// closing word pipes or redirects.
// shortcut: a function body counts as a group, so `f() { echo $v; }; x=$(f)` is allowed; follow calls if that bites.
function stdoutConsumed(found) {
  const end = found.index + found[0].length;
  const groups = [];
  // Pushes an opener, pops on a closer; true when it closed a group. A `)` in
  // a `case` closes a pattern, not a group.
  const step = (token) => {
    const top = groups[groups.length - 1];
    if ((token === '`' && top === '`') || (token === ')' && top !== 'case') ||
      /^(?:\}|fi|done|esac)$/.test(token)) return groups.pop() !== undefined;
    if (token === ')') return false;
    groups.push(/^(?:\$\(|[<>]\(|`|case)$/.test(token) ? token : 'group');
    return false;
  };
  const blank = (text) => text.replace(/\$\{[^}]*\}/g, (m) => '_'.repeat(m.length));
  for (const m of blank(words.slice(0, found.index)).matchAll(GROUP_TOKEN)) step(m[0]);
  if (groups.some((g) => g !== 'group' && g !== 'case')) return true;
  const after = blank(words.slice(end));
  if (sendsStdoutAway(after)) return true;
  let level = groups.length;
  for (const m of after.matchAll(GROUP_TOKEN)) {
    if (!level) break;
    if (!step(m[0]) || groups.length >= level) continue;
    level = groups.length;
    if (sendsStdoutAway(after.slice(m.index + m[0].length))) return true;
  }
  return false;
}

let hit = null;
for (const a of words.matchAll(new RegExp(ASSIGNMENT_AT + '([A-Za-z_]\\w*)=', 'g'))) {
  const at = a.index + a[0].length;
  const value = valueAt(at);
  if (!value) continue;
  // Whitespace counts outside an expansion only, where the source shows it.
  const multiWord = /\s/.test(value.replace(/\$\{[^}]*\}|\$\([^)]*\)|`[^`]*`|\$\w+/g, ''));
  const substitution = /\$\(|`/.test(maskedViews(value).patterns);
  if (!multiWord && !substitution) continue;
  const end = at + value.length;
  if (!ONLY_ASSIGNMENTS.test(words.slice(end))) continue;
  const name = a[1];
  const argument = new RegExp('(?<=\\s)\\$(?:' + name + '(?![\\w[])|\\{' + name + '\\})(?=[\\s;&|)}<>]|$)', 'g');
  argument.lastIndex = end;
  for (const found of words.matchAll(argument)) {
    if (reassignedBefore(name, end, found.index)) break;
    // A parameter's braces and operators are part of an argument, not command boundaries.
    // So is a closed substitution: `echo "$(date)" $v` is still an echo.
    let before = words.slice(0, found.index).replace(/\$\{[^}]*\}/g, '_').replace(/`[^`]*`/g, '_');
    for (let flat; (flat = before.replace(/\$\([^()]*\)/g, '_')) !== before;) before = flat;
    before = before.split(/[;&|(){}\n`]/).pop().trim();
    const command = (before + ' ').replace(new RegExp('^' + COMMAND_START), '').trim();
    // These contexts do not split in bash either, or parse the value again.
    if (!command || /^(?:case|for|select|eval)\b/.test(command)) continue;
    // echo/print joins its arguments with spaces: on the tool output only
    // whitespace differs, but a consumer reads other lines than in bash (#570).
    if (/^(?:echo|print)\b/.test(command) && !stdoutConsumed(found)) continue;
    deny('zsh-wordsplit-guard: silent non-split. `' + found[0] + '` as an unquoted ' +
      'argument after assigning `' + name + '` a multi-word value or command substitution ' +
      'stays ONE argument: the Bash tool runs zsh, where parameter expansion is not word-split. ' +
      'Use `${(f)' + name + '}` for one argument per line (preserving spaces), `${=' + name +
      '}` to split on IFS, or build an array `' + name + '=(...)` and pass `"${' + name +
      '[@]}"`. Quote `"$' + name + '"` if one argument is intended. ' + NOSPLIT_OPT_OUT_HINT);
    process.exit(0);
  }
  if (!multiWord || !/^["']/.test(value)) continue;
  const use = new RegExp(COMMAND_START + '(\\$(?:' + name + '(?![\\w[])|\\{' + name + '\\}))', 'g');
  use.lastIndex = end;
  const found = use.exec(words);
  // A later assignment, `DC=ls` or `DC=(docker compose)`, is what the use reads.
  if (!found || reassignedBefore(name, end, found.index)) continue;
  hit = { name: name, value: value, expansion: found[1] };
  break;
}

if (!hit) process.exit(0);

const { name } = hit;
const value = hit.value.slice(1, -1);
// bash splits the value into literal words; copied unquoted into a function or
// an array, a `<`, `|`, glob, or a word starting with `=` or `~` would become
// syntax, so only plain text is shown.
const hintWords = /^[\w\s.\/=:,@%+~-]*$/.test(value) && !/(?:^|\s)[=~]/.test(value) ? value : '…';
// A prefix keeps the function off any command or builtin of the same name
// (`git`, `exec`, `test`).
const fn = 'run_' + name.toLowerCase();
deny(
  'zsh-wordsplit-guard: stored command. `' + name + '=' + hit.value + '` then `' +
  hit.expansion + ' …` runs the whole value as ONE command name: the Bash tool ' +
  'runs zsh, where parameter expansion is not word-split, so it fails with ' +
  '`command not found`. Rewrite as one of:\n' +
  '  - a function: `' + fn + '() { ' + hintWords + ' "$@"; }`, then `' + fn + ' …`\n' +
  '  - an array: `' + name + '=(' + hintWords + ')`, then `"${' + name + '[@]}" …`\n' +
  '  - `${=' + name + '} …` — split on IFS\n' +
  NOSPLIT_OPT_OUT_HINT);
