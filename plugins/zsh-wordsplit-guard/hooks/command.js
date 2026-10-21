#!/usr/bin/env node
// zsh-wordsplit-guard, stored-command rule — a PreToolUse hook on Bash, beside
// guard.js (loops) and expansion.js (other zsh expansions).
//
// `DC="docker compose -f a.yml"; $DC build`: bash splits the value into a
// command and its arguments, zsh looks the whole value up as one command name
// and fails with `command not found`. A quoted value holding whitespace, run as
// a command, exists only to be split again: the source proves the intent, as
// for guard.js's loop items. Scope, what is not read and the measurement:
// docs/adr/0031-the-wordsplit-guard-flags-a-stored-command.md.
const { readBashInput, deny, maskedViews, noSplitOptedOut, NOSPLIT_OPT_OUT_HINT } = require('./scan');

const input = readBashInput();
if (!input || noSplitOptedOut(input)) process.exit(0);

// Quoted text is blank in `words`, so assignment values are read from the raw
// command at the same offsets. `(( $n ))` is arithmetic, not a command.
const words = maskedViews(input.command).words
  .replace(/\(\((?:[^()]|\([^()]*\))*\)\)/g, (m) => m.replace(/[^\n]/g, ' '));

// Where a command starts, and an assignment word, whose value stops at an operator.
const START = '(?:^|[;&|({\\n])\\s*';
const ASSIGN = '[A-Za-z_]\\w*=[^\\s;&|]*\\s+';
// An assignment that is a command of its own, a declaration builtin's
// included: one in front of a command (`DC="a b" cmd`) sets it for that
// command only, and `echo DC="a b"` is an argument.
const ASSIGNMENT_AT = '(?<=' + START + '(?:(?:export|local|typeset|declare|readonly)' +
  '\\s+(?:-\\w+\\s+)*)?(?:' + ASSIGN + ')*)';
const ONLY_ASSIGNMENTS = /^(?:\s+[A-Za-z_]\w*=[^\s;&|]*)*\s*(?:[;&|\n)}]|$)/;
// The first word of a command, past reserved words, assignment prefixes and
// precommand modifiers with their options: the ones taking an argument are
// named (`sudo -u root`, `env -u NAME`, `exec -a name`).
const MODIFIER = '(?:then|do|else|elif|if|while|until|!|nohup|noglob|' +
  'time(?:\\s+-\\w+)*|command(?:\\s+-\\w+)*|' +
  'exec(?:\\s+-a\\s+\\S+|\\s+-\\w+)*|env(?:\\s+-u\\s+\\S+|\\s+-\\w+)*|' +
  'sudo(?:\\s+-[ugUCDhprtT]\\s+\\S+|\\s+-\\w+)*)\\s+';
const COMMAND_START = START + '(?:' + MODIFIER + '|' + ASSIGN + ')*';

let hit = null;
for (const a of words.matchAll(new RegExp(ASSIGNMENT_AT + '([A-Za-z_]\\w*)=', 'g'))) {
  const at = a.index + a[0].length;
  const value = /^'[^']*'|^"(?:[^"\\]|\\.)*"/.exec(input.command.slice(at));
  // Whitespace counts outside an expansion only, where the source shows it.
  if (!value || !/\s/.test(value[0].replace(/\$\{[^}]*\}|\$\([^)]*\)|`[^`]*`|\$\w+/g, ''))) continue;
  const end = at + value[0].length;
  if (!ONLY_ASSIGNMENTS.test(words.slice(end))) continue;
  const name = a[1];
  const use = new RegExp(COMMAND_START + '(\\$(?:' + name + '(?![\\w[])|\\{' + name + '\\}))', 'g');
  use.lastIndex = end;
  const found = use.exec(words);
  // A later assignment, `DC=ls` or `DC=(docker compose)`, is what the use reads.
  if (!found || new RegExp(ASSIGNMENT_AT + name + '=').test(words.slice(end, found.index))) continue;
  hit = { name: name, value: value[0], expansion: found[1] };
  break;
}

if (!hit) process.exit(0);

const { name } = hit;
const value = hit.value.slice(1, -1);
// bash splits the value into literal words; copied unquoted into a function or
// an array, a `<`, `|`, glob, or a word starting with `=` or `~` would become
// syntax, so only plain text is shown.
const hintWords = /^[\w\s.\/=:,@%+~$-]*$/.test(value) && !/(?:^|\s)[=~]/.test(value) ? value : '…';
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
