#!/usr/bin/env node
// Self-check that catalog.js alone classifies entries. Run: node scripts/catalog-predicates.test.js
//
// A script in scripts/ that reads `typeof plugin.source` or `plugin.source.source`
// itself answers that question a second time, and the next source kind slips past
// it silently: `typeof === 'object'` held for git-subdir and url alike only by
// accident. Scope: the top level of scripts/, by pattern; a destructured `source`
// is not caught.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RE_DERIVED = /typeof [^ ]*\.source\b|\??\.source\??\.source\b/;
const offenders = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'catalog.js')
  .flatMap((f) => fs.readFileSync(path.join(__dirname, f), 'utf8').split('\n')
    .map((line, i) => (RE_DERIVED.test(line) ? `scripts/${f}:${i + 1}: ${line.trim()}` : null))
    .filter(Boolean));

assert.deepStrictEqual(offenders, [],
  `classify entries with catalog.js predicates (isLocal, isExternal, isGitSubdir, isUrl):\n${offenders.join('\n')}`);
for (const spelling of ["typeof plugin.source === 'object'", 'typeof plugin?.source', 'typeof (e.source)',
  "e.source.source === 'url'", 'e.source?.source']) {
  assert.ok(RE_DERIVED.test(spelling), `the pattern catches ${spelling}`);
}

console.log('ok');
