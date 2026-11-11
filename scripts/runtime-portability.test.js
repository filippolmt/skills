const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discoverArtifacts, frontmatterHooks, validateDistribution } = require('./distribution.js');
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

// taste-skill v2.5.1 (#620): a guarded Stop hook in the frontmatter is Claude's, not a portable dependency.
const hooked = '---\nname: example\ndescription: Example.\nhooks:\n  Stop:\n    - hooks:\n        - type: command\n          command: \'node ${CLAUDE_PLUGIN_ROOT:+"$CLAUDE_PLUGIN_ROOT/gate.mjs"}\'\nlicense: MIT\n---\n# Body\n';
const hookKey = 'example/hook:example/SKILL.md#Stop[0]';
const discovered = (root) => [{ name: 'example', sourceRoot: root, repoRoot: root, artifacts: discoverArtifacts({ name: 'example' }, root) }];

test('a frontmatter hook is its own artifact and stays out of pi and Codex projections', () => fixture((root) => {
  fs.writeFileSync(path.join(root, 'example/SKILL.md'), hooked);
  const inventory = discovered(root);
  assert.deepEqual(inventory[0].artifacts.map((a) => a.id), ['hook:example/SKILL.md#Stop[0]', 'skill:example/SKILL.md']);
  assert.throws(() => validateDistribution(inventory), /unclassified hook artifact/);
  const result = validateDistribution(inventory, { artifacts: { [hookKey]: { codex: unsupported, pi: unsupported } } });
  const dest = path.join(root, 'output');
  assert.deepEqual(buildFromInventory(dest, [{ name: 'example', source: './plugins/example' }], result), ['example']);
  const projected = fs.readFileSync(path.join(dest, 'example/SKILL.md'), 'utf8');
  assert.equal(projected, '---\nname: example\ndescription: Example.\nlicense: MIT\n---\n# Body\n');
  assert.doesNotThrow(() => validateSkillDirectories(dest));
}));

test('frontmatter hooks do not excuse a Claude runtime dependency in the body', () => fixture((root) => {
  fs.writeFileSync(path.join(root, 'example/SKILL.md'), hooked + command);
  const inventory = discovered(root);
  assert.throws(() => validateDistribution(inventory, { artifacts: { [hookKey]: { codex: unsupported, pi: unsupported } } }), /CLAUDE_PLUGIN_ROOT/);
}));

test('frontmatter hooks in a form the reader cannot parse fail instead of leaking', () => {
  assert.throws(() => frontmatterHooks('---\nname: x\nhooks: {Stop: []}\n---\n'), /unsupported frontmatter hooks/);
  assert.throws(() => frontmatterHooks('---\nname: x\nhooks:\n---\n'), /no registration/);
  assert.deepEqual(frontmatterHooks('---\nname: x\nhooks:\n  Stop:\n  - a: 1\n  - b: 2\n  PostToolUse:\n    - c: 3\n---\n').ids, ['#Stop[0]', '#Stop[1]', '#PostToolUse[0]']);
  // A column-0 comment inside the block must not end it early and leave the rest behind.
  const commented = frontmatterHooks('---\nname: x\nhooks:\n  Stop:\n# the gate\n    - command: gate\nlicense: MIT\n---\n');
  assert.deepEqual(commented.ids, ['#Stop[0]']);
  assert.equal(commented.withoutHooks, '---\nname: x\nlicense: MIT\n---\n');
});

test('generated validation reads the projection as is: a frontmatter hook there is a leak', () => fixture((root) => {
  fs.writeFileSync(path.join(root, 'example/SKILL.md'), hooked.replace('${CLAUDE_PLUGIN_ROOT:+"$CLAUDE_PLUGIN_ROOT/gate.mjs"}', 'gate.mjs'));
  assert.throws(() => validateSkillDirectories(root), /frontmatter hooks leaked/);
}));

test('only a SKILL.md frontmatter is excused: a reference with hooks still fails on CLAUDE_PLUGIN_ROOT', () => fixture((root) => {
  fs.writeFileSync(path.join(root, 'example/SKILL.md'), skill);
  fs.writeFileSync(path.join(root, 'example/reference.md'), hooked);
  assert.throws(() => validateSkillDirectories(root), /CLAUDE_PLUGIN_ROOT/);
}));

test('a sibling skill loaded with the Skill tool must be a runtime dependency', () => fixture((root, inventory) => {
  const body = skill + 'Call the Skill tool with `tdd`, then the Skill tool for "grilling" and "example". Use `other-tool` freely.\n';
  fs.writeFileSync(path.join(root, 'example/SKILL.md'), body);
  const siblings = ['tdd', 'grilling', 'other-tool'].map((name) => ({ name, artifacts: [{ kind: 'skill', id: `skill:${name}` }] }));
  const all = [...inventory, ...siblings];
  assert.throws(() => validateDistribution(all), /example\/skill:example\/SKILL\.md: calls tdd, grilling with the Skill tool/);
  assert.doesNotThrow(() => validateDistribution(all, { runtimeDependencies: { example: ['tdd', 'grilling'] } }));
}));
