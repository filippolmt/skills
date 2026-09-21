// Guards the pi package commands whose semantics have drifted before.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

test('documents an unpinned install and explicit package update', () => {
  assert.match(readme, /^pi install git:github\.com\/filippolmt\/skills$/m);
  assert.doesNotMatch(readme, /^pi install git:github\.com\/filippolmt\/skills@/m);
  assert.match(readme, /^pi update --extensions$/m);
  assert.doesNotMatch(readme, /^pi update$/m);
});
