// Self-check for prune-removed.js. Run: node scripts/prune-removed.test.js
// The CLI's only verdict comes from build(), tested in gen-skills-tree.test.js;
// what is left to check is what a removal does to the manifests that name it.
const { test } = require('node:test');
const assert = require('node:assert');
const { breakingBump, pruneManifest } = require('./prune-removed.js');

test('a breaking bump is a minor below 1.0.0 and a major above', () => {
  assert.equal(breakingBump('0.1.3'), '0.2.0');
  assert.equal(breakingBump('1.4.2'), '2.0.0');
});

test('pruneManifest drops the gone dependency and bumps the version', () => {
  const m = { name: 'triage-bundle', version: '0.1.0', dependencies: ['triage', 'grilling'] };
  assert.deepEqual(pruneManifest(m, ['grilling']), { ...m, version: '0.2.0', dependencies: ['triage'] });
});

test('pruneManifest leaves a manifest that names none of them alone', () => {
  assert.equal(pruneManifest({ version: '0.1.0', dependencies: ['triage'] }, ['grilling']), null);
  assert.equal(pruneManifest({ version: '0.1.0' }, ['grilling']), null);
});
