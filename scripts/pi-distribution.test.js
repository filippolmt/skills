const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderPiBundleFilters, validatePiBundleFilters } = require('./gen-pi.js');

const artifact = (entry, kind, artifactPath, disposition = 'native') => ({
  entry,
  kind,
  path: artifactPath,
  dispositions: { pi: { disposition } },
});

test('renders bundle filters with native and converted skills but no unsupported hooks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-distribution-'));
  fs.mkdirSync(path.join(root, 'skill'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skill', 'SKILL.md'), '---\nname: core\ndescription: Core.\n---\n');
  const inventory = [
    { name: 'bundle', sourceRoot: root, runtimeDependencies: ['core', 'guard'], artifacts: [artifact('bundle', 'bundle', null, 'adapted')] },
    { name: 'core', sourceRoot: root, runtimeDependencies: [], artifacts: [artifact('core', 'skill', 'skill/SKILL.md'), artifact('core', 'agent', 'agents/reviewer.md', 'adapted')] },
    { name: 'guard', sourceRoot: root, runtimeDependencies: [], artifacts: [artifact('guard', 'hook', 'hooks.json', 'unsupported')] },
  ];

  const output = renderPiBundleFilters(inventory);
  assert.match(output, /## `bundle`/);
  assert.match(output, /"\+skills\/core"/);
  assert.match(output, /"\+skills\/core-reviewer"/);
  assert.doesNotMatch(output, /guard/);
  assert.throws(() => validatePiBundleFilters(inventory, path.join(root, 'missing-tree')), /bundle filter references missing skill/);
  const tree = path.join(root, 'tree');
  for (const name of ['core', 'core-reviewer']) {
    fs.mkdirSync(path.join(tree, name), { recursive: true });
    fs.writeFileSync(path.join(tree, name, 'SKILL.md'), 'ok');
  }
  assert.doesNotThrow(() => validatePiBundleFilters(inventory, tree));
  fs.rmSync(root, { recursive: true, force: true });
});
