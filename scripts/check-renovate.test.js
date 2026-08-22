#!/usr/bin/env node
// Self-check for check-renovate.js. Run: node scripts/check-renovate.test.js
//
// This guard's failure mode is silence: a regex that stops matching reports
// nothing, and neither does a guard broken the same way. So the cases below are
// trees that FAIL — running it against the live repo (as CI does) only ever shows
// the passing shape, which is the one case that proves nothing.
const assert = require('assert');
const { coverageError } = require('./check-renovate.js');

// Two git-subdir entries pinned the two ways renovate.json splits on — a branch
// `ref` and a tag `ref` — plus a local plugin, which no manager should claim.
const TEXT = `{
  "plugins": [
    { "name": "branch-pinned", "source": { "source": "git-subdir", "url": "https://github.com/o/r", "path": "skills/a", "ref": "main", "sha": "aaaaaaa" } },
    { "name": "tag-pinned", "source": { "source": "git-subdir", "url": "https://github.com/o/r", "path": "skills/b", "ref": "skill-v1.2.3", "sha": "bbbbbbb" } },
    { "name": "local-plugin", "source": "./plugins/local" }
  ]
}`;
// Parsed from the same text the regexes run against, so the fixture cannot drift
// from itself.
const CATALOG = { text: TEXT, plugins: JSON.parse(TEXT).plugins };

const BRANCH = '"ref": "(?:main|master)", "sha": "(?<currentDigest>[^"]+)"';
const TAG = '"ref": "[a-z-]*v[0-9][^"]*", "sha": "(?<currentDigest>[^"]+)"';
const managers = (...matchStrings) => ({ customManagers: matchStrings.map((m) => ({ matchStrings: [m] })) });

// --- covered: the two managers together claim both git-subdir entries, and the
// local plugin is not expected to be claimed by either ---
assert.strictEqual(coverageError(CATALOG, managers(BRANCH, TAG)), null,
  'both managers together cover every git-subdir entry');

// --- the failure this guard exists for: one manager's shape stops matching, so
// its entries silently drop out of Renovate's reach ---
let err = coverageError(CATALOG, managers(BRANCH));
assert.match(err, /matches 1 entry but/, 'the uncovered entry is counted');
assert.match(err, /has 2 git-subdir entries/, 'against the number that should be covered');
assert.match(err, /auto-bumps will silently stop/, 'and says what breaks');

// --- and the opposite, which is also both faults at once: the branch entry is
// claimed twice and the tag entry not at all. Two offsets against two expected
// entries, so a plain count calls this covered and only the offsets tell them
// apart — the reason this guard tracks WHERE each match starts. ---
err = coverageError(CATALOG, managers(BRANCH, BRANCH));
assert.match(err, /1 marketplace entry is matched by more than one customManager/,
  'the double claim is reported, not cancelled out against the uncovered one');
assert.match(err, /fight over the same sha/, 'and says why that is bad');

// --- no usable manager at all: a renovate.json with none, and one whose entry
// carries no matchStrings array to read ---
assert.match(coverageError(CATALOG, {}), /no customManager with matchStrings found/,
  'an empty renovate.json is a failure, not a pass');
assert.match(coverageError(CATALOG, { customManagers: [{ description: 'no matchStrings' }] }),
  /no customManager with matchStrings found/, 'a manager without matchStrings is not a manager');

// --- a catalog with no git-subdir entries at all: nothing to cover, and the
// managers matching nothing is then correct ---
const localOnly = { text: '{"plugins":[{"name":"x","source":"./plugins/x"}]}', plugins: [{ name: 'x', source: './plugins/x' }] };
assert.strictEqual(coverageError(localOnly, managers(BRANCH, TAG)), null,
  'no git-subdir entries => zero matches is the right answer');

console.log('ok');
