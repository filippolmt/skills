const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

for (const [name, generators, smoke] of [
  ['pi', ['gen-skills-tree', 'gen-distribution', 'gen-pi'], 'test-pi-package.sh'],
  ['codex', ['gen-skills-tree', 'gen-distribution', 'gen-codex'], 'test-codex-marketplace.sh'],
]) {
  test(`${name} integration materializes projections before its smoke test`, () => {
    const workflow = fs.readFileSync(path.join(root, `.github/workflows/${name}-integration.yml`), 'utf8');
    const smokeIndex = workflow.lastIndexOf(smoke);

    assert.doesNotMatch(workflow, /node scripts\/gen-[^\n]+ --check/);
    assert.notStrictEqual(smokeIndex, -1);
    for (const generator of generators) {
      const generatorIndex = workflow.lastIndexOf(`node scripts/${generator}.js`);
      assert.notStrictEqual(generatorIndex, -1);
      assert.ok(generatorIndex < smokeIndex, `${generator} must run before ${smoke}`);
    }
  });
}
