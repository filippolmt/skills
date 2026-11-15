// The rule families of zsh-wordsplit-guard: one line each, stated at session
// start by session.js. Every verdict a hook gives names its families (scan.js),
// and rewrites.test.js fails on a verdict with none or a family no verdict uses,
// so a new rule cannot ship without its line (ADR-0044).
const FAMILIES = {
  split: 'zsh does not word-split `$var`: use `${=var}`, `${(f)var}` or an array, and ' +
    'a function for a stored command, not `$CMD args`.',
  glob: 'Quote a glob in a flag value or URL (`--include=\'*.md\'`); escape a path glob ' +
    'that may match nothing (`\\*.md`): zsh aborts the line.',
  equals: 'A leading `=` expands to a command path: write `\\=`.',
  modifier: '`$name:x` is a history modifier, even in double quotes: write `${name}:x`.',
  pattern: '`(…)` in `${v/pattern/…}` is a glob group: escape the parentheses.',
  bashonly: 'bash\'s `${!name}` and `${v@Q}` fail: write `${(P)name}` and `${(qq)v}`.',
  special: '`path` is tied to `PATH`, `status` is read-only: name variables otherwise.',
};

const summary = () => 'The Bash tool runs zsh. zsh-wordsplit-guard rewrites or denies ' +
  'these bash habits; write the zsh form:\n' +
  Object.values(FAMILIES).map((line) => '- ' + line).join('\n');

module.exports = { FAMILIES, summary };
