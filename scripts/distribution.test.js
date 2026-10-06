const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discoverArtifacts, declaredDependencies, classify, validateDistribution, renderParity } = require('./distribution.js');
const { validatePackageRoots } = require('./gen-distribution.js');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'distribution-'));
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return dir;
}

test('discovers every distribution artifact in a plugin', () => {
  const dir = fixture({
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'many', version: '1.0.0', futureCapability: true }),
    'skills/one/SKILL.md': '---\nname: one\ndescription: One.\n---\n',
    'commands/check.md': '# Check',
    'agents/reviewer.md': '# Reviewer',
    'hooks/hooks.json': JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [] }], Stop: [{ hooks: [] }] } }),
    'mcp.json': JSON.stringify({ mcpServers: { docs: { url: 'https://example.test' } } }),
  });
  try {
    assert.deepEqual(discoverArtifacts({ name: 'many' }, dir).map((a) => a.id), [
      'agent:agents/reviewer.md',
      'command:commands/check.md',
      'hook:hooks/hooks.json#PreToolUse[0]',
      'hook:hooks/hooks.json#Stop[0]',
      'manifest-capability:.claude-plugin/plugin.json#futureCapability',
      'mcp:mcp.json#docs',
      'skill:skills/one/SKILL.md',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('discovers artifacts from manifest-declared paths', () => {
  const dir = fixture({
    '.claude-plugin/plugin.json': JSON.stringify({
      name: 'custom',
      skills: './custom-skills',
      commands: ['./custom/check.md'],
      agents: './custom-agents',
      hooks: './extra-hooks.json',
      mcpServers: './custom-mcp.json',
    }),
    'custom-skills/one/SKILL.md': '---\nname: one\ndescription: One.\n---\n',
    'custom/check.md': '# Check',
    'custom-agents/reviewer.md': '# Reviewer',
    'hooks/hooks.json': JSON.stringify({ hooks: { Stop: [{}] } }),
    'extra-hooks.json': JSON.stringify({ hooks: { PreToolUse: [{}] } }),
    'custom-mcp.json': JSON.stringify({ mcpServers: { docs: { url: 'https://example.test' } } }),
  });
  try {
    assert.deepEqual(discoverArtifacts({ name: 'custom' }, dir).map((a) => a.id), [
      'agent:custom-agents/reviewer.md',
      'command:custom/check.md',
      'hook:extra-hooks.json#PreToolUse[0]',
      'hook:hooks/hooks.json#Stop[0]',
      'mcp:custom-mcp.json#docs',
      'skill:custom-skills/one/SKILL.md',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reads manifest dependencies as derivable runtime edges', () => {
  const dir = fixture({ '.claude-plugin/plugin.json': JSON.stringify({ name: 'bundle', dependencies: ['one', 'two'] }) });
  try {
    assert.deepEqual(declaredDependencies(dir), ['one', 'two']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a bare skill does not mistake its packaged agent metadata for a Claude agent', () => {
  const dir = fixture({
    'SKILL.md': '---\nname: one\ndescription: One.\n---\n',
    'agents/openai.yaml': 'interface: {}',
  });
  try {
    assert.deepEqual(discoverArtifacts({ name: 'one' }, dir).map((a) => a.id), ['skill:SKILL.md']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('portable artifacts have derived dispositions while hooks require an explicit decision', () => {
  assert.equal(classify({ kind: 'skill' }, {}).codex.disposition, 'native');
  assert.equal(classify({ kind: 'command' }, {}).pi.disposition, 'adapted');
  assert.throws(() => classify({ entry: 'guard', id: 'hook:x', kind: 'hook' }, {}), /unclassified/);
});

test('validation rejects orphan metadata and unresolved runtime edges', () => {
  const inventory = [{ name: 'one', artifacts: [{ entry: 'one', id: 'skill:SKILL.md', kind: 'skill' }] }];
  assert.throws(() => validateDistribution(inventory, { artifacts: { 'gone/hook:x': {} } }), /orphaned artifact metadata/);
  assert.throws(() => validateDistribution(inventory, { runtimeDependencies: { one: ['gone'] } }), /unknown dependency/);
});

test('validation rejects unknown metadata fields and validates presentation overrides', () => {
  const inventory = [{ name: 'one', artifacts: [{ entry: 'one', id: 'skill:SKILL.md', kind: 'skill' }] }];
  assert.throws(() => validateDistribution(inventory, { typo: {} }), /unknown distribution metadata field: typo/);
  assert.throws(() => validateDistribution(inventory, {
    artifacts: { 'one/skill:SKILL.md': { codex: { disposition: 'native', typo: true }, pi: { disposition: 'native' } } },
  }), /unknown codex outcome field: typo/);
  assert.throws(() => validateDistribution(inventory, {
    presentationOverrides: { one: { typo: 'x' } },
  }), /unknown presentation override field: typo/);
  assert.doesNotThrow(() => validateDistribution(inventory, {
    presentationOverrides: { one: { displayName: 'One', description: 'First plugin.' } },
  }));
});

test('validation verifies upstream adaptation sources', () => {
  const dir = fixture({ 'native/hook.json': '{}', 'tests/smoke.js': '' });
  const inventory = [{
    name: 'one',
    repoRoot: dir,
    artifacts: [{ entry: 'one', id: 'hook:hooks.json#Stop[0]', kind: 'hook' }],
  }];
  const key = 'one/hook:hooks.json#Stop[0]';
  const decision = (sourcePath) => ({
    artifacts: { [key]: {
      codex: { disposition: 'adapted', detail: 'Use upstream.', sourcePath, evidencePath: 'tests/smoke.js' },
      pi: { disposition: 'unsupported', limitation: 'No hooks.', fallback: 'Run manually.' },
    } },
  });
  assert.doesNotThrow(() => validateDistribution(inventory, decision('native/hook.json')));
  assert.throws(() => validateDistribution(inventory, decision('native/missing.json')), /adaptation source does not exist/);
  assert.throws(() => validateDistribution(inventory, decision('../outside.json')), /adaptation source escapes repository/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('validation tolerates metadata for an upstream path awaiting prune', () => {
  const metadata = {
    artifacts: { 'gone/hook:hooks/hooks.json#Stop[0]': {} },
    runtimeDependencies: { gone: ['one'], one: ['gone'] },
  };
  const inventory = [{ name: 'one', artifacts: [{ entry: 'one', id: 'skill:SKILL.md', kind: 'skill' }] }];
  assert.doesNotThrow(() => validateDistribution(inventory, metadata, { absentEntries: ['gone'] }));
});

test('validation rejects entries with no artifact and dependency cycles', () => {
  assert.throws(() => validateDistribution([{ name: 'empty', artifacts: [] }], {}), /no distribution artifacts/);
  const artifact = (entry) => ({ entry, id: 'skill:SKILL.md', kind: 'skill' });
  const inventory = [
    { name: 'one', artifacts: [artifact('one')] },
    { name: 'two', artifacts: [artifact('two')] },
  ];
  assert.throws(() => validateDistribution(inventory, { runtimeDependencies: { one: ['two'], two: ['one'] } }), /dependency cycle/);
});

test('validation requires exact unsupported guidance', () => {
  const inventory = [{ name: 'guard', artifacts: [{ entry: 'guard', id: 'hook:hooks/hooks.json#Stop[0]', kind: 'hook' }] }];
  const key = 'guard/hook:hooks/hooks.json#Stop[0]';
  assert.throws(() => validateDistribution(inventory, { artifacts: { [key]: { codex: { disposition: 'unsupported' }, pi: { disposition: 'unsupported' } } } }), /limitation and fallback/);
});

test('generated packages must be backed by the catalog', () => {
  const dir = fixture({ 'one/plugin.json': '{}', 'orphan/plugin.json': '{}' });
  try {
    assert.throws(() => validatePackageRoots([{ name: 'one' }], dir), /no catalog entry: orphan/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parity is generated from inventory and decisions', () => {
  const inventory = [{ name: 'one', artifacts: [{ entry: 'one', id: 'skill:SKILL.md', kind: 'skill' }] }];
  const out = renderParity(validateDistribution(inventory, {}));
  assert.match(out, /`one` \| `skill:SKILL.md` \| — \| Native .* \| Native /);
  assert.match(out, /Target dispositions/);
  assert.match(out, /generated by `node scripts\/gen-distribution.js`/);
});
