#!/usr/bin/env node
// zsh-wordsplit-guard — one PreToolUse hook on the Bash tool.
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
// Scope is deliberately one pattern — `for NAME in $var` — because that is the
// one where the intent is BY DEFINITION to iterate over several elements, so
// non-split is always a bug. Unquoted `$var` in argument position (`grep $flags
// f`) is left alone: it is usually a single word and correct, and denying it
// would only teach ALLOW_ZSH_NOSPLIT=1, which kills the `for` check too.
//
// Deny rather than warn: an advisory arrives after the wrong output is already
// in context, and the pattern is narrow enough that a hit is almost always a
// real bug. Flipping to `"ask"` is a one-line change if false positives show up.
//
// Skipped, for a first cut, rather than reasoned about: any command carrying a
// heredoc or an explicit `bash -c`/`sh -c`, where the body may run under a shell
// that DOES split and the same pattern is correct. False negative over false
// positive — a wrong deny on the critical path is what makes a guard hated.
//
// Not suggested anywhere: `setopt shwordsplit`. It changes the semantics of
// every later expansion in that shell, trading one silent bug for a broader one.
//
// Opt-outs, mirroring agent-report-guard:
//   - per call    — put `[nosplit]` in the Bash call's `description`
//   - session     — ALLOW_ZSH_NOSPLIT=1
const fs = require('fs');

const OPT_IN = /\[nosplit\]/i;
// Explicit values only: `ALLOW_ZSH_NOSPLIT=0` must mean off, not "non-empty
// string, therefore on".
const ON = new Set(['1', 'true', 'yes']);

// `<<` heredoc (but not `<<<`, a zsh here-string) or an explicit other shell.
const OTHER_SHELL = /(?<!<)<<(?!<)|\b(?:bash|sh|dash|ksh)\b[^\n]*?\s-c\b/;
// A `for NAME in <list>`, list ending at `;` or newline (zsh needs one before `do`).
const FOR_HEADER = /\bfor\s+[A-Za-z_]\w*\s+in\s+([^\n;]*)/g;
// `$var` or `${var}` — a plain name only. Excluded by construction: `$1`, `$@`,
// `$*`, `$#` (positionals: correct or split anyway), `${=v}`, `${(f)v}`,
// `${v[@]}` (an array expansion yields several words regardless of the option).
const PLAIN_EXPANSION = /\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*)(?![\w[]))/;

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) || {}; } catch (e) { /* no stdin */ }

const toolInput = input.tool_input || {};
const command = String(toolInput.command || '');
const optedOut =
  ON.has(String(process.env.ALLOW_ZSH_NOSPLIT || '').toLowerCase()) ||
  OPT_IN.test(toolInput.description || '');

if (input.tool_name !== 'Bash' || !command || optedOut || OTHER_SHELL.test(command)) {
  process.exit(0);
}

// Quoted and command-substitution regions can hold a `for` header that is not
// one (`echo "for x in $v"`), and inside a real header they are the correct
// forms — `"$v"`, `"${a[@]}"`, `$(cmd)`. Blanking them handles both at once.
const scannable = command
  .replace(/\$\((?:[^()]|\([^()]*\))*\)/g, ' ')
  .replace(/`[^`]*`/g, ' ')
  .replace(/"(?:\\.|[^"\\])*"/g, ' ')
  .replace(/'[^']*'/g, ' ');

let hit = null;
for (const header of scannable.matchAll(FOR_HEADER)) {
  const found = PLAIN_EXPANSION.exec(header[1]);
  if (!found) continue;
  const name = found[1] || found[2];
  // `a=(x y); for i in $a` is fine: an array expands to several words even with
  // SH_WORD_SPLIT off. Only skip when this command is what assigned the array.
  if (new RegExp('(?:^|[;&|(\\s])' + name + '=\\(').test(scannable)) continue;
  hit = { expansion: found[0], name: name, header: header[0].trim() };
  break;
}

if (!hit) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      'zsh-wordsplit-guard: `' + hit.header + '` iterates ONCE over the whole ' +
      'string. The Bash tool runs zsh, where parameter expansion is not ' +
      'word-split, so ' + hit.expansion + ' stays one word instead of several — ' +
      'no error, just a silent wrong result from the second element on. Rewrite ' +
      'as one of:\n' +
      '  - `${=' + hit.name + '}` — split on IFS\n' +
      '  - `${(f)' + hit.name + '}` — split per line (safe with paths containing spaces)\n' +
      '  - `arr=(...)` then `for x in "${arr[@]}"` — for values you build yourself\n' +
      '  - a literal list, or `$(cmd)` directly, which does split in zsh\n' +
      'Do not use `setopt shwordsplit`: it changes every later expansion in that ' +
      'shell. If the non-split is deliberate, put [nosplit] in the description ' +
      '(or set ALLOW_ZSH_NOSPLIT=1 for the session).',
  },
}));
