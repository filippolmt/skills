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
// Scope is deliberately one construct — `for NAME in <expansion>` — because
// that is where the intent is BY DEFINITION to iterate over several elements,
// so non-split is always a bug. Unquoted `$var` in argument position (`grep
// $flags f`) is left alone: it is usually a single word and correct, and denying
// it would only teach ALLOW_ZSH_NOSPLIT=1, which kills the `for` check too.
//
// Deny rather than warn: an advisory arrives after the wrong output is already
// in context, and the construct is narrow enough that a hit is almost always a
// real bug. Flipping to `"ask"` is a one-line change if false positives show up.
//
// Not suggested anywhere: `setopt shwordsplit`. It changes the semantics of
// every later expansion in that shell, trading one silent bug for a broader one.
//
// Opt-outs, mirroring agent-report-guard:
//   - per call    — put `[nosplit]` in the Bash call's `description`
//   - session     — ALLOW_ZSH_NOSPLIT=1
const fs = require('fs');

const NOSPLIT_OPT_OUT = /\[nosplit\]/i;
// Explicit values only: `ALLOW_ZSH_NOSPLIT=0` must mean off, not "non-empty
// string, therefore on".
const ON = new Set(['1', 'true', 'yes']);

// A `for NAME in <list>`, list ending at `;` or newline (zsh needs one before `do`).
const FOR_HEADER = /\bfor\s+[A-Za-z_]\w*\s+in\s+([^\n;]*)/g;
// `$var`, `${var}`, and a braced form carrying a modifier (`${v:-a b c}`,
// `${v#p}`, `${v%x}`, `${v/a/b}`) — none of which split. Excluded by
// construction: `$1`, `$@`, `$*`, `$#` (positionals: correct, or split anyway),
// `${=v}` and `${(f)v}` (explicit splits), `${v[@]}` (an array expansion yields
// several words whatever the option is).
const NONSPLIT_EXPANSION = /\$(?:\{([A-Za-z_]\w*)(?:[:#%/][^}]*)?\}|([A-Za-z_]\w*)(?![\w[]))/;
// `<<` heredoc, but not `<<<`, which is a zsh here-string.
const HEREDOC = /(?<!<)<<(?!<)/;

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) || {}; } catch (e) { /* no stdin */ }

const toolInput = input.tool_input || {};
const command = String(toolInput.command || '');
const optedOut =
  ON.has(String(process.env.ALLOW_ZSH_NOSPLIT || '').toLowerCase()) ||
  NOSPLIT_OPT_OUT.test(toolInput.description || '');

if (input.tool_name !== 'Bash' || !command || optedOut) process.exit(0);

// Blanking, in this order, removes three things at once: a header that is only
// text (`echo "for x in $v"`), the forms that are already correct inside a real
// header (`"$v"`, `"${a[@]}"`, `$(cmd)`), and a `#` comment — which must be
// found only AFTER quotes are gone, so that a `#` inside a string is not read as
// one. The cost is honest and one-sided: a real loop nested inside a quoted
// payload is invisible too, so `bash -c '... for x in $v ...'` — which does run
// under a shell that splits — needs no special case, and `zsh -c '…'` slips
// through with it. False negative over a wrong deny on the critical path.
const scannable = command
  .replace(/\$\((?:[^()]|\([^()]*\))*\)/g, ' ')
  .replace(/`[^`]*`/g, ' ')
  .replace(/"(?:\\.|[^"\\])*"/g, ' ')
  .replace(/'[^']*'/g, ' ')
  .replace(/(^|\s)#[^\n]*/g, '$1 ');

// ponytail: everything from the first `<<` on is treated as heredoc body, since
// finding the terminator means real parsing. A loop BEFORE the heredoc is still
// checked; one after it is not. Narrow the limit to the terminator if that
// blind spot ever bites.
const heredocAt = scannable.search(HEREDOC);
const limit = heredocAt === -1 ? scannable.length : heredocAt;

let hit = null;
for (const header of scannable.matchAll(FOR_HEADER)) {
  if (header.index >= limit) break;
  const found = NONSPLIT_EXPANSION.exec(header[1]);
  if (!found) continue;
  const name = found[1] || found[2];
  // `a=(x y); for i in $a` is fine: an array expands to several words even with
  // SH_WORD_SPLIT off. Only what was assigned BEFORE this loop can be one.
  if (new RegExp('(?:^|[;&|(\\s])' + name + '=\\(').test(scannable.slice(0, header.index))) continue;
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
