// Self-check for check-branch-pins.js. Run: node scripts/check-branch-pins.test.js
//
// The network half is thin; what can go wrong silently is the tag shape, picking
// the pins and the latest tag, and the verdict, so those run here against fakes
// and the real renovate.json.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { releaseTagPattern, branchPins, latestTags, describe } = require('./check-branch-pins.js');

const pattern = releaseTagPattern(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'renovate.json'), 'utf8')));
const entry = (repo, ref, sha) => ({ name: `${repo}-${sha}`, source: { source: 'git-subdir', url: `https://github.com/${repo}`, path: 'x', ref, sha } });

test('the tag shape is the one renovate.json\'s tag manager accepts', () => {
  for (const tag of ['v2.1.2', 'skill-v4.6.0']) assert.match(tag, pattern);
  for (const tag of ['2.1.2', 'v2.1', 'v1.0.0-rc1', 'archive/taste-skill-v2', 'Skill-v1.0.0']) assert.doesNotMatch(tag, pattern);
});

test('branchPins keeps only main/master entries, one set of shas per repo', () => {
  const pins = branchPins([
    entry('acme/a', 'main', 's1'),
    entry('acme/a', 'main', 's1'),
    entry('acme/a', 'main', 's2'),
    entry('acme/b', 'master', 's3'),
    entry('acme/c', 'v1.2.3', 's4'),
    { name: 'local', source: './plugins/local' },
  ]);
  assert.deepEqual([...pins], [['acme/a', ['s1', 's2']], ['acme/b', ['s3']]]);
});

test('latestTags picks the highest semver per series and ignores other shapes', () => {
  assert.deepEqual(latestTags(['v2.10.0', 'v2.9.9', 'v10.0.0-rc1', '3.0.0', 'archive/v9', 'v2.1.2'], pattern), ['v2.10.0']);
  assert.deepEqual(latestTags(['cli-v1.0.0', 'skill-v4.6.0', 'skill-v4.10.0', 'v0.1.0'], pattern).sort(), ['cli-v1.0.0', 'skill-v4.10.0', 'v0.1.0']);
  assert.deepEqual(latestTags(['nightly', 'release-2026'], pattern), []);
});

test('a tag at or past the pin, or diverged, is a finding; one behind is a note', () => {
  const at = (compare) => describe('acme/a', 'abcdef0123', 'v1.0.0', compare);
  assert.deepEqual(at({ status: 'identical' }), { finding: true, line: '- `acme/a`: pinned at `abcdef0`, `v1.0.0` is the same commit — switch to it' });
  assert.match(at({ status: 'ahead', ahead_by: 3 }).line, /3 commits ahead/);
  assert.equal(at({ status: 'diverged' }).finding, true);
  assert.deepEqual(at({ status: 'behind', behind_by: 7 }), { finding: false, line: '- `acme/a`: pinned at `abcdef0`, `v1.0.0` is 7 commits behind — switching would downgrade' });
});
