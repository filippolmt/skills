const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateDistribution } = require('./distribution.js');
const { validateSkillDirectories } = require('./portable-artifacts.js');
const { buildFromInventory } = require('./gen-skills-tree.js');

const skill = '---\nname: example\ndescription: Example.\n---\n';
const command = 'Run "${CLAUDE_PLUGIN_ROOT}/scripts/tool".\n';

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-portability-'));
  try {
    fs.mkdirSync(path.join(root, 'example'));
    fs.writeFileSync(path.join(root, 'example/SKILL.md'), skill + command);
    const inventory = [{ name: 'example', sourceRoot: root, repoRoot: root, artifacts: [
      { entry: 'example', kind: 'skill', path: 'example/SKILL.md', id: 'skill:example/SKILL.md' },
    ] }];
    run(root, inventory);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const unsupported = { disposition: 'unsupported', limitation: 'Requires the Claude plugin runtime.', fallback: 'Install the Claude plugin.' };

test('inventory rejects Claude runtime dependencies presented as portable', () => fixture((root, inventory) => {
  assert.throws(() => validateDistribution(inventory), /CLAUDE_PLUGIN_ROOT/);
}));

test('explicit unsupported outcomes retain their limitation without promising portability', () => fixture((root, inventory) => {
  const result = validateDistribution(inventory, { artifacts: {
    'example/skill:example/SKILL.md': { codex: unsupported, pi: unsupported },
  } });
  const dest = path.join(root, 'output');
  assert.deepEqual(buildFromInventory(dest, [{ name: 'example', source: './plugins/example' }], result), []);
  assert.equal(fs.existsSync(dest), false);
}));

test('an unavailable whole-plugin runtime can be declared once for every artifact', () => fixture((root, inventory) => {
  const metadata = { unsupportedEntries: { example: { codex: unsupported, pi: unsupported } } };
  const result = validateDistribution(inventory, metadata);
  assert.equal(result[0].artifacts[0].dispositions.pi.disposition, 'unsupported');
  assert.throws(() => validateDistribution([], metadata), /orphaned unsupported entry/);
  assert.throws(() => validateDistribution(inventory, { unsupportedEntries: {
    example: { codex: { disposition: 'native' }, pi: unsupported },
  } }), /requires unsupported/);
  assert.throws(() => validateDistribution(inventory, { unsupportedEntries: {
    example: { codex: { disposition: 'unsupported' }, pi: unsupported },
  } }), /limitation and fallback/);
}));

test('a portable upstream adaptation is checked instead of the Claude source', () => fixture((root, inventory) => {
  fs.writeFileSync(path.join(root, 'native.md'), skill + 'Run the packaged script.\n');
  fs.writeFileSync(path.join(root, 'proof.js'), '// upstream test\n');
  assert.doesNotThrow(() => validateDistribution(inventory, { artifacts: {
    'example/skill:example/SKILL.md': {
      codex: { disposition: 'adapted', detail: 'Native upstream variant.', sourcePath: 'native.md', evidencePath: 'proof.js' },
      pi: unsupported,
    },
  } }));
}));

test('generated skill validation catches leaked Claude runtime variables in references too', () => fixture((root) => {
  fs.writeFileSync(path.join(root, 'example/SKILL.md'), skill);
  fs.writeFileSync(path.join(root, 'example/runtime.md'), command);
  assert.throws(() => validateSkillDirectories(root), /CLAUDE_PLUGIN_ROOT/);
}));
