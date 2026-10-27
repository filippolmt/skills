// Only catalog.js decides what kind of entry a plugin is. A script that reads
// `typeof plugin.source` or `plugin.source.source` itself answers that question a
// second time, and the next source kind slips past it silently: `typeof ===
// 'object'` held for git-subdir and url alike only by accident.
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RE_DERIVED = /typeof [A-Za-z_.]*\.source\b|\.source\.source\b/;
const offenders = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'catalog.js')
  .flatMap((f) => fs.readFileSync(path.join(__dirname, f), 'utf8').split('\n')
    .map((line, i) => (RE_DERIVED.test(line) ? `scripts/${f}:${i + 1}: ${line.trim()}` : null))
    .filter(Boolean));

assert.deepStrictEqual(offenders, [],
  `classify entries with catalog.js predicates (isLocal, isGitSubdir, …):\n${offenders.join('\n')}`);
assert.ok(RE_DERIVED.test("typeof plugin.source === 'object'") && RE_DERIVED.test("e.source.source === 'url'"),
  'the pattern still catches both spellings');

console.log('ok');
