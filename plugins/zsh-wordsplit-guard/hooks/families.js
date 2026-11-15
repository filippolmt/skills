// The rule families of zsh-wordsplit-guard: one line each, stated at session
// start by session.js. Every verdict a hook gives names its families (scan.js),
// and rewrites.test.js fails on a verdict with none or a family no verdict uses,
// so a new rule cannot ship without its line (ADR-0044).
const FAMILIES = {
  split: '`$var` is not word-split: use `${=var}`, `${(f)var}` or an array; run a ' +
    'stored command as a function.',
  glob: 'Quote a glob in a flag value or URL (`--include=\'*.md\'`); escape a path glob ' +
    'matching nothing (`\\*.md`).',
  equals: 'A leading `=` expands to a command path: write `\\=`.',
  modifier: '`$name:x` is a history modifier, even in double quotes: write `${name}:x`.',
  pattern: '`(…)` in `${v/pattern/…}` is a glob group: escape the parentheses.',
  bashonly: 'Write `${(P)name}` and `${(qq)v}` for bash\'s `${!name}` and `${v@Q}`.',
  special: '`path` is tied to `PATH`, `status` is read-only: name variables otherwise.',
};

// Families whose rules expand nothing: a deny made only of them says zsh
// "reads" the command differently, not "expands" it.
const EXPAND_NOTHING = new Set(['special']);

const summary = () => 'The Bash tool runs zsh; zsh-wordsplit-guard rewrites or denies ' +
  'these bash habits:\n' +
  Object.values(FAMILIES).map((line) => '- ' + line).join('\n');

module.exports = { FAMILIES, EXPAND_NOTHING, summary };
